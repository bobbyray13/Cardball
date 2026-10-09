/**
 * Security hardening: defensive response headers, upload signature sniffing,
 * login/register rate limiting, and the expired-session sweep. Real Postgres,
 * real Fastify, same throwaway-database pattern as api.test.ts.
 */
import { mkdirSync, rmSync } from 'node:fs';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, runMigrations, sessions } from '@cardball/db';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE, purgeExpiredSessions } from '../src/auth.js';
import type { Ctx } from '../src/context.js';
import { env } from '../src/env.js';
import { resetRateLimits } from '../src/rateLimit.js';

const BASE_URL = env.databaseUrl;
// Its own database, like the drafts and tournaments suites, so the files can
// bootstrap in parallel without truncating or migrating each other's tables.
const DB_NAME = `${new URL(BASE_URL).pathname.slice(1)}_security`;
const TEST_URL = BASE_URL.replace(/\/[^/]+$/, `/${DB_NAME}`);
const ADMIN_URL = TEST_URL.replace(/\/[^/]+$/, '/postgres');
const THROWAWAY_DB = DB_NAME.startsWith('cardball_test_');

let app: Awaited<ReturnType<typeof buildApp>>;
let db: Ctx['db'];
let sql: ReturnType<typeof createDb>['sql'];

const PASSWORD = 'correct-horse-battery';

type Method = 'GET' | 'POST';

function call(method: Method, url: string, opts: { body?: unknown; payload?: Buffer; headers?: Record<string, string>; token?: string } = {}): Promise<LightMyRequestResponse> {
  const options: InjectOptions = {
    method,
    url,
    headers: { ...(opts.token ? { cookie: `${SESSION_COOKIE}=${opts.token}` } : {}), ...opts.headers },
  };
  if (opts.payload !== undefined) options.payload = opts.payload;
  else if (opts.body !== undefined) options.payload = opts.body as InjectOptions['payload'];
  return app.inject(options);
}

function body<T = Record<string, unknown>>(res: LightMyRequestResponse): T {
  return JSON.parse(res.body) as T;
}

/** A multipart body carrying one file part with the given name, type, and bytes. */
function multipart(fileName: string, mimeType: string, bytes: Buffer): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----cardballsec';
  const head = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
    `Content-Type: ${mimeType}`,
    '',
    '',
  ].join('\r\n');
  return {
    payload: Buffer.concat([Buffer.from(head, 'utf8'), bytes, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

beforeAll(async () => {
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    await admin.unsafe(`create database "${DB_NAME}"`).catch(() => undefined);
  } finally {
    await admin.end();
  }
  await runMigrations(TEST_URL);

  const created = createDb(TEST_URL);
  db = created.db;
  sql = created.sql;
  rmSync(env.uploadDir, { recursive: true, force: true });
  mkdirSync(env.uploadDir, { recursive: true });

  app = await buildApp({ db, io: null } satisfies Ctx, { logger: false });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await sql?.end();
  rmSync(env.uploadDir, { recursive: true, force: true });
  if (THROWAWAY_DB) {
    const admin = postgres(ADMIN_URL, { max: 1 });
    try {
      await admin.unsafe(`drop database if exists "${DB_NAME}" with (force)`);
    } finally {
      await admin.end();
    }
  }
});

describe('response headers', () => {
  it('sends defensive headers on API responses', async () => {
    const res = await call('GET', '/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
});

describe('login rate limiting', () => {
  beforeAll(async () => {
    resetRateLimits();
    const res = await call('POST', '/api/auth/register', {
      body: { email: 'commish@example.com', password: PASSWORD, displayName: 'Commissioner' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('blocks the account after ten failed attempts, even with the right password', async () => {
    resetRateLimits();
    for (let i = 0; i < 10; i++) {
      const res = await call('POST', '/api/auth/login', { body: { email: 'commish@example.com', password: 'wrong-password' } });
      expect(res.statusCode).toBe(401);
    }
    // The address is blocked now, so even correct credentials wait out the window.
    const blocked = await call('POST', '/api/auth/login', { body: { email: 'commish@example.com', password: PASSWORD } });
    expect(blocked.statusCode).toBe(429);
    expect(body<{ error: string }>(blocked).error).toMatch(/too many/i);
  });

  it('clears the counters after a successful login', async () => {
    resetRateLimits();
    for (let i = 0; i < 9; i++) {
      const res = await call('POST', '/api/auth/login', { body: { email: 'commish@example.com', password: 'wrong-password' } });
      expect(res.statusCode).toBe(401);
    }
    const good = await call('POST', '/api/auth/login', { body: { email: 'commish@example.com', password: PASSWORD } });
    expect(good.statusCode).toBe(200);
    // The successful login forgave this address and account.
    const after = await call('POST', '/api/auth/login', { body: { email: 'commish@example.com', password: 'wrong-password' } });
    expect(after.statusCode).toBe(401);
  });
});

describe('register rate limiting', () => {
  it('throttles a burst of registrations from one address', async () => {
    resetRateLimits();
    // Registration attempts count whether or not they are valid: this run is
    // all invite-less (the league is set up), so every one fails cheaply.
    for (let i = 0; i < 20; i++) {
      const res = await call('POST', '/api/auth/register', {
        body: { email: `bot${i}@example.com`, password: PASSWORD, displayName: `Bot ${i}` },
      });
      expect(res.statusCode).toBe(400);
    }
    const blocked = await call('POST', '/api/auth/register', {
      body: { email: 'bot20@example.com', password: PASSWORD, displayName: 'Bot 20' },
    });
    expect(blocked.statusCode).toBe(429);
    expect(body<{ error: string }>(blocked).error).toMatch(/too many/i);
  });
});

describe('upload signature sniffing', () => {
  let token = '';

  beforeAll(async () => {
    resetRateLimits();
    const res = await call('POST', '/api/auth/login', { body: { email: 'commish@example.com', password: PASSWORD } });
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
    token = cookie?.value ?? '';
  });

  it('accepts bytes that match the claimed image type', async () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), Buffer.from('a plausible jpeg body')]);
    const upload = multipart('card.jpg', 'image/jpeg', bytes);
    const res = await call('POST', '/api/photos', { token, payload: upload.payload, headers: upload.headers });
    if (res.statusCode !== 200) throw new Error(res.body);
    const { photoId } = body<{ photoId: number }>(res);
    const fetched = await call('GET', `/api/photos/${photoId}`, { token });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers['content-type']).toBe('image/jpeg');
    expect(fetched.rawPayload.equals(bytes)).toBe(true);
  });

  it('rejects text masquerading as a JPEG', async () => {
    const bytes = Buffer.from('definitely not an image, just some text');
    const upload = multipart('evil.jpg', 'image/jpeg', bytes);
    const res = await call('POST', '/api/photos', { token, payload: upload.payload, headers: upload.headers });
    expect(res.statusCode).toBe(400);
    expect(body<{ error: string }>(res).error).toMatch(/not a real/i);
  });

  it('rejects a real image lying about its type', async () => {
    const pngBytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png body')]);
    const upload = multipart('card.jpg', 'image/jpeg', pngBytes);
    const res = await call('POST', '/api/photos', { token, payload: upload.payload, headers: upload.headers });
    expect(res.statusCode).toBe(400);
  });
});

describe('session housekeeping', () => {
  it('purges expired sessions and keeps live ones', async () => {
    const now = Date.now();
    const inserted = await db
      .insert(sessions)
      .values([
        { id: 'expired-a', userId: 1, expiresAt: new Date(now - 86_400_000) },
        { id: 'expired-b', userId: 1, expiresAt: new Date(now - 1) },
        { id: 'live-a', userId: 1, expiresAt: new Date(now + 86_400_000) },
      ])
      .returning({ id: sessions.id });
    expect(inserted).toHaveLength(3);

    await purgeExpiredSessions({ db, io: null } satisfies Ctx);

    // The sweep removed ours; other rows from this file's logins are untouched.
    const remaining = (await db.select({ id: sessions.id }).from(sessions)).map((r) => r.id);
    expect(remaining).not.toContain('expired-a');
    expect(remaining).not.toContain('expired-b');
    expect(remaining).toContain('live-a');
  });
});
