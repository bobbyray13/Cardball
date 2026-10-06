/**
 * Draft-room tests against a real Postgres.
 *
 * Uses its own database (derived from the configured test URL) so it can run
 * alongside the API suite without either run truncating the other's tables.
 */
import postgres from 'postgres';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, people, runMigrations, seasons } from '@cardball/db';
import type { Db } from '@cardball/db';
import type { DraftView } from '@cardball/shared';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE } from '../src/auth.js';
import type { Ctx } from '../src/context.js';
import { env } from '../src/env.js';

const BASE_URL = env.databaseUrl;
const DB_NAME = `${new URL(BASE_URL).pathname.slice(1)}_drafts`;
const TEST_URL = BASE_URL.replace(/\/[^/]+$/, `/${DB_NAME}`);
const ADMIN_URL = TEST_URL.replace(/\/[^/]+$/, '/postgres');
const CARD_YEAR = 2004;

let app: Awaited<ReturnType<typeof buildApp>>;
let sql: Db['sql'];
let hostToken = '';
let guestToken = '';

function call(
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<LightMyRequestResponse> {
  const options: InjectOptions = { method, url, headers: opts.token ? { cookie: `${SESSION_COOKIE}=${opts.token}` } : {} };
  if (opts.body !== undefined) options.payload = opts.body as InjectOptions['payload'];
  return app.inject(options);
}

const parse = <T>(res: LightMyRequestResponse): T => JSON.parse(res.body) as T;

async function register(email: string, displayName: string, inviteCode?: string): Promise<string> {
  const res = await call('POST', '/api/auth/register', {
    body: { email, password: 'hunter2hunter2', displayName, ...(inviteCode ? { inviteCode } : {}) },
  });
  expect(res.statusCode, res.body).toBe(200);
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) throw new Error('no session cookie');
  return cookie.value;
}

/** A playable hitter with seasons across the card's stat window. */
async function seedHitter(db: Db['db'], n: number): Promise<void> {
  const [person] = await db
    .insert(people)
    .values({
      bbrefId: `draft${String(n).padStart(2, '0')}`,
      nameFirst: 'Draft',
      nameLast: `Player${n}`,
      bats: 'R',
      throws: 'R',
      debutYear: 1998,
      finalYear: 2004,
    })
    .returning({ id: people.id });
  await db.insert(seasons).values(
    [1998, 1999, 2000, 2001, 2002, 2003].map((year) => ({
      personId: person!.id,
      year,
      teamLabel: 'TST',
      games: 150,
      ab: 500,
      h: 150,
      avg: 0.3,
      doubles: 25,
      triples: 3,
      homeRuns: 20 + n,
      rbi: 80,
      sb: 10,
      pa: 550,
      primaryPosition: 'RF',
      positionsPlayed: [{ position: 'RF' as const, games: 140, rating: 1 }],
    })),
  );
}

beforeAll(async () => {
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    await admin.unsafe(`drop database if exists "${DB_NAME}" with (force)`).catch(() => undefined);
    await admin.unsafe(`create database "${DB_NAME}"`);
  } finally {
    await admin.end();
  }
  await runMigrations(TEST_URL);

  const { db, sql: conn } = createDb(TEST_URL);
  sql = conn;
  const tables = await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`;
  if (tables.length) {
    await sql.unsafe(`truncate table ${tables.map((t) => `"${t.tablename}"`).join(', ')} restart identity cascade`);
  }

  for (let i = 1; i <= 30; i++) await seedHitter(db, i);

  app = await buildApp({ db, io: null } satisfies Ctx, { logger: false });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await sql?.end();
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    await admin.unsafe(`drop database if exists "${DB_NAME}" with (force)`);
  } finally {
    await admin.end();
  }
});

describe('draft rooms', () => {
  let draftId = 0;
  const config = { rounds: 2, packSize: 3, cardYear: CARD_YEAR, playableOnly: true };

  beforeAll(async () => {
    hostToken = await register('drafter@example.com', 'Drafter');
    const invite = parse<{ code: string }>(await call('POST', '/api/invites', { token: hostToken, body: {} })).code;
    guestToken = await register('guest@example.com', 'Guest', invite);
  });

  it('opens a room with the host in seat one', async () => {
    const res = await call('POST', '/api/drafts', { token: hostToken, body: config });
    expect(res.statusCode, res.body).toBe(200);
    const draft = parse<{ draft: DraftView }>(res).draft;
    draftId = draft.id;

    expect(draft.phase).toBe('lobby');
    expect(draft.participants).toHaveLength(1);
    expect(draft.participants[0]).toMatchObject({ seat: 0, isHost: true, name: 'Drafter' });
    expect(draft.myPack).toEqual([]);
  });

  it('refuses a card year with nobody in its stat window', async () => {
    const res = await call('POST', '/api/drafts', { token: hostToken, body: { ...config, cardYear: 1900 } });
    expect(res.statusCode).toBe(400);
    expect(parse<{ error: string }>(res).error).toMatch(/no players appeared/i);
  });

  it('seats a second manager', async () => {
    const res = await call('POST', `/api/drafts/${draftId}/join`, { token: guestToken });
    expect(res.statusCode).toBe(200);
    const draft = parse<{ draft: DraftView }>(res).draft;
    expect(draft.participants).toHaveLength(2);
    expect(draft.participants[1]).toMatchObject({ seat: 1, name: 'Guest', isHost: false });
  });

  it('lets only the host start, and only once', async () => {
    expect((await call('POST', `/api/drafts/${draftId}/start`, { token: guestToken })).statusCode).toBe(403);

    const started = await call('POST', `/api/drafts/${draftId}/start`, { token: hostToken });
    expect(started.statusCode).toBe(200);
    const draft = parse<{ draft: DraftView }>(started).draft;
    expect(draft.phase).toBe('active');
    expect(draft.round).toBe(1);
    expect(draft.turn).toBe(0);
    expect(draft.myPack).toHaveLength(config.packSize);
    expect(draft.myPack.every((c) => c.cardYear === CARD_YEAR)).toBe(true);
    expect(draft.myPack.every((c) => c.playable)).toBe(true);

    expect((await call('POST', `/api/drafts/${draftId}/start`, { token: hostToken })).statusCode).toBe(400);
  });

  it('keeps the guest out of the host’s turn', async () => {
    const peek = await call('GET', `/api/drafts/${draftId}`, { token: guestToken });
    const pack = parse<{ draft: DraftView }>(peek).draft.myPack;
    const res = await call('POST', `/api/drafts/${draftId}/pick`, { token: guestToken, body: { cardId: pack[0]!.id } });
    expect(res.statusCode).toBe(400);
    expect(parse<{ error: string }>(res).error).toMatch(/wait for your turn/i);
  });

  it('rejects a card that is not in the pack', async () => {
    const res = await call('POST', `/api/drafts/${draftId}/pick`, { token: hostToken, body: { cardId: 'not-a-card' } });
    expect(res.statusCode).toBe(400);
    expect(parse<{ error: string }>(res).error).toMatch(/not in your pack/i);
  });

  it('passes the pack after a pick, and files the card in the collection', async () => {
    const before = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${draftId}`, { token: hostToken })).draft;
    const taken = before.myPack[0]!;

    const res = await call('POST', `/api/drafts/${draftId}/pick`, { token: hostToken, body: { cardId: taken.id } });
    expect(res.statusCode).toBe(200);
    const draft = parse<{ draft: DraftView }>(res).draft;

    expect(draft.turn).toBe(1);
    expect(draft.myPicks.map((c) => c.id)).toEqual([taken.id]);
    // The host now holds the untouched pack passed from the other seat.
    expect(draft.myPack).toHaveLength(config.packSize);

    // The guest now holds the host's leftovers, one short.
    const guest = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${draftId}`, { token: guestToken })).draft;
    expect(guest.myPack.map((c) => c.id).sort()).toEqual(
      before.myPack.map((c) => c.id).filter((id) => id !== taken.id).sort(),
    );

    const collection = parse<{ cards: { card: { name: string }; notes: string | null }[] }>(
      await call('GET', '/api/collection', { token: hostToken }),
    ).cards;
    expect(collection.map((c) => c.card.name)).toContain(taken.name);
    expect(collection.find((c) => c.card.name === taken.name)?.notes).toMatch(/^Drafted/);
  });

  it('runs both rounds, then closes with a full set of picks', async () => {
    const tokens = [hostToken, guestToken];
    const totalPicks = config.rounds * config.packSize * 2;
    let picks = 0;
    let finished: DraftView | null = null;

    for (let step = 0; step < totalPicks + 2 && !finished; step++) {
      const view = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${draftId}`, { token: hostToken })).draft;
      if (view.phase === 'finished') {
        finished = view;
        break;
      }
      const token = tokens[view.turn]!;
      const mine = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${draftId}`, { token })).draft;
      const card = mine.myPack[0];
      expect(card, `seat ${view.turn} should be holding a pack on turn ${view.turn}`).toBeDefined();

      const res = await call('POST', `/api/drafts/${draftId}/pick`, { token, body: { cardId: card!.id } });
      expect(res.statusCode).toBe(200);
      picks++;
    }

    const final = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${draftId}`, { token: hostToken })).draft;
    expect(final.phase).toBe('finished');
    // The previous test already made the opening pick.
    expect(picks).toBe(totalPicks - 1);
    expect(final.myPicks).toHaveLength(config.rounds * config.packSize);
    expect(final.pickCounts).toEqual({ '0': config.rounds * config.packSize, '1': config.rounds * config.packSize });
    expect(final.log.at(-1)?.text).toMatch(/draft complete/i);
  });

  it('hands every drafted card to the collection', async () => {
    const cards = parse<{ cards: unknown[] }>(await call('GET', '/api/collection', { token: hostToken })).cards;
    expect(cards).toHaveLength(config.rounds * config.packSize);
  });

  it('will not start a room with one manager', async () => {
    const solo = parse<{ draft: DraftView }>(await call('POST', '/api/drafts', { token: hostToken, body: config })).draft;
    const res = await call('POST', `/api/drafts/${solo.id}/start`, { token: hostToken });
    expect(res.statusCode).toBe(400);
    expect(parse<{ error: string }>(res).error).toMatch(/at least 2 managers/i);
  });

  it('only lets the host close the room', async () => {
    expect((await call('DELETE', `/api/drafts/${draftId}`, { token: guestToken })).statusCode).toBe(403);
    expect((await call('DELETE', `/api/drafts/${draftId}`, { token: hostToken })).statusCode).toBe(200);
    expect((await call('GET', `/api/drafts/${draftId}`, { token: hostToken })).statusCode).toBe(404);
  });
});
