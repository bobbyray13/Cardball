/**
 * End-to-end API smoke test: real Postgres, real Fastify app, real engine.
 *
 * It registers two accounts, seeds a small stats database, builds teams, and
 * plays two complete games through the HTTP API — a bot game and a remote game
 * between two managers — driving every decision with the engine's own bot
 * policy. Run it with `pnpm --filter @cardball/server test` after `pnpm db:up`.
 */
import { mkdirSync, rmSync } from 'node:fs';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { botAction, waitingOn } from '@cardball/engine';
import type { GameState } from '@cardball/engine';
import type { Position } from '@cardball/shared';
import { createDb, people, runMigrations, seasons } from '@cardball/db';
import type { Db } from '@cardball/db';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE } from '../src/auth.js';
import type { Ctx } from '../src/context.js';
import { env } from '../src/env.js';

const TEST_URL = env.databaseUrl;
const ADMIN_URL = TEST_URL.replace(/\/[^/]+$/, '/postgres');
const DB_NAME = new URL(TEST_URL).pathname.slice(1);
/** Throwaway databases are created and dropped by the run; a pinned TEST_DATABASE_URL is left alone. */
const THROWAWAY_DB = DB_NAME.startsWith('cardball_test_');

const FIELD_POSITIONS: Position[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
const CARD_YEAR = 2006;

let app: Awaited<ReturnType<typeof buildApp>>;
let db: Db['db'];
let sql: Db['sql'];
let hostToken = '';
let guestToken = '';
let hostTeamId = 0;
let guestTeamId = 0;
let hostCardIds: number[] = [];
let guestCardIds: number[] = [];
let photoId = 0;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

function call(
  method: Method,
  url: string,
  opts: { token?: string; body?: unknown; payload?: Buffer; headers?: Record<string, string> } = {},
): Promise<LightMyRequestResponse> {
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

function tokenFrom(res: LightMyRequestResponse): string {
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) throw new Error('No session cookie in the response');
  return cookie.value;
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/** Insert a person plus one season row per year, cloned from a template. */
async function seedPerson(
  info: typeof people.$inferInsert,
  years: number[],
  template: Omit<typeof seasons.$inferInsert, 'personId' | 'year'>,
): Promise<number> {
  const [row] = await db.insert(people).values(info).returning({ id: people.id });
  const id = row!.id;
  await db.insert(seasons).values(years.map((year) => ({ ...template, personId: id, year })));
  return id;
}

const hitterTemplate = (rating: number): Omit<typeof seasons.$inferInsert, 'personId' | 'year'> => ({
  teamLabel: 'Testville Nine',
  games: 150,
  ab: 500,
  h: 150,
  avg: 0.3,
  doubles: 25,
  triples: 3,
  homeRuns: 20,
  rbi: 80,
  sb: 10,
  pa: 550,
  primaryPosition: 'C',
  positionsPlayed: FIELD_POSITIONS.map((position) => ({ position, games: 90, rating })),
});

const span = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

async function seedStats(): Promise<void> {
  // A famous name for the search test.
  await seedPerson(
    { bbrefId: 'mayswi01', nameFirst: 'Willie', nameLast: 'Mays', bats: 'R', throws: 'R', debutYear: 1951, finalYear: 1973 },
    span(1951, 1973),
    {
      ...hitterTemplate(3),
      ab: 550,
      h: 170,
      avg: 0.309,
      homeRuns: 35,
      rbi: 100,
      primaryPosition: 'CF',
      positionsPlayed: [{ position: 'CF', games: 140, rating: 3 }],
    },
  );

  // Nine hitters who can field anywhere, so any eight of them fill the field.
  for (let i = 1; i <= 9; i++) {
    await seedPerson(
      {
        bbrefId: `testhit0${i}`,
        nameFirst: 'Test',
        nameLast: `Hitter${i}`,
        bats: 'R',
        throws: 'R',
        debutYear: 2000,
        finalYear: 2006,
      },
      span(2000, 2006),
      hitterTemplate(1),
    );
  }

  // One starting pitcher: 200 innings a year, so he can take the mound.
  await seedPerson(
    { bbrefId: 'testace01', nameFirst: 'Test', nameLast: 'Ace', bats: 'L', throws: 'R', debutYear: 2000, finalYear: 2006, isStarter: true },
    span(2000, 2006),
    {
      teamLabel: 'Testville Nine',
      games: 32,
      ab: 60,
      h: 10,
      avg: 0.167,
      pa: 65,
      pitchGames: 32,
      pitchIpOuts: 620,
      pitchEra: 3.0,
      pitchBf: 850,
      primaryPosition: 'P',
      positionsPlayed: [{ position: 'P', games: 32, rating: 0 }],
    },
  );

  // A second, merely good starter. His 3.60 ERA makes him an uncommon card, so
  // a team can field a legal lineup under a match that allows no rare cards.
  await seedPerson(
    { bbrefId: 'testspare1', nameFirst: 'Test', nameLast: 'Spare', bats: 'R', throws: 'R', debutYear: 2000, finalYear: 2006, isStarter: true },
    span(2000, 2006),
    {
      teamLabel: 'Testville Nine',
      games: 30,
      ab: 60,
      h: 8,
      avg: 0.133,
      pa: 65,
      pitchGames: 30,
      pitchIpOuts: 600,
      pitchEra: 3.6,
      pitchBf: 840,
      primaryPosition: 'P',
      positionsPlayed: [{ position: 'P', games: 30, rating: 0 }],
    },
  );
}

async function buildRoster(token: string): Promise<{ teamId: number; cardIds: number[] }> {
  const found = body<{ people: { id: number }[] }>(
    await call('GET', '/api/people/search?q=Test%20Hitter&limit=50', { token }),
  );
  const aces = body<{ people: { id: number }[] }>(await call('GET', '/api/people/search?q=Test%20Ace', { token }));
  const ids = [...found.people.map((p) => p.id), ...aces.people.map((p) => p.id)];
  expect(ids).toHaveLength(10);

  const cardIds: number[] = [];
  for (const personId of ids) {
    const res = await call('POST', '/api/collection', { token, body: { personId, cardYear: CARD_YEAR } });
    expect(res.statusCode).toBe(200);
    cardIds.push(body<{ card: { id: number } }>(res).card.id);
  }

  const team = body<{ team: { id: number } }>(await call('POST', '/api/teams', { token, body: { name: `Team ${token.slice(0, 4)}` } }));
  const teamId = team.team.id;
  const roster = await call('PUT', `/api/teams/${teamId}/roster`, { token, body: { userCardIds: cardIds } });
  expect(roster.statusCode).toBe(200);
  const auto = await call('POST', `/api/teams/${teamId}/auto-lineup`, { token });
  expect(auto.statusCode).toBe(200);
  expect(body<{ team: { lineupProblem: string | null } }>(auto).team.lineupProblem).toBeNull();
  return { teamId, cardIds };
}

// ---------------------------------------------------------------------------
// Game driver
// ---------------------------------------------------------------------------

/** Press play, then answer every remaining decision with the engine's bot policy. */
async function playOut(
  gameId: number,
  viewerToken: string,
  tokenForSide: (side: 'home' | 'away', state: GameState) => string,
): Promise<GameState> {
  const current = body<{ game: { state: GameState | null } }>(await call('GET', `/api/games/${gameId}`, { token: viewerToken }));
  let state = current.game.state;
  expect(state).not.toBeNull();

  if (state!.phase === 'lobby') {
    // Remote games need both managers to press play; hotseat/bot need one.
    for (const side of ['home', 'away'] as const) {
      const res = await call('POST', `/api/games/${gameId}/actions`, {
        token: tokenForSide(side, state!),
        body: { action: { type: 'start-game' } },
      });
      expect(res.statusCode).toBe(200);
      state = body<{ game: { state: GameState } }>(res).game.state;
      if (state.phase !== 'lobby') break;
    }
  }

  let steps = 0;
  while (state!.phase === 'live' && steps++ < 5_000) {
    const waiting = waitingOn(state!);
    if (!waiting) throw new Error('Game stalled with no side waiting to act');
    const action = botAction(state!, waiting.side);
    if (!action) throw new Error(`No legal move for ${waiting.kind}: ${waiting.prompt}`);
    const res = await call('POST', `/api/games/${gameId}/actions`, { token: tokenForSide(waiting.side, state!), body: { action } });
    if (res.statusCode !== 200) throw new Error(`Action ${action.type} rejected: ${res.body}`);
    state = body<{ game: { state: GameState } }>(res).game.state;
  }
  expect(steps).toBeLessThan(5_000);
  return state!;
}

// ---------------------------------------------------------------------------

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
  const tables = await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`;
  if (tables.length) {
    await sql.unsafe(`truncate table ${tables.map((t) => `"${t.tablename}"`).join(', ')} restart identity cascade`);
  }

  rmSync(env.uploadDir, { recursive: true, force: true });
  mkdirSync(env.uploadDir, { recursive: true });

  await seedStats();
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

describe('accounts and invites', () => {
  it('reports that a fresh install needs setup', async () => {
    const res = await call('GET', '/api/auth/status');
    expect(res.statusCode).toBe(200);
    expect(body<{ needsSetup: boolean }>(res).needsSetup).toBe(true);
  });

  it('makes the first account the commissioner, with no invite needed', async () => {
    const res = await call('POST', '/api/auth/register', {
      body: { email: 'Commish@Example.com', password: 'hunter2hunter2', displayName: 'Commissioner' },
    });
    expect(res.statusCode).toBe(200);
    expect(body<{ user: { isAdmin: boolean; email: string } }>(res).user).toMatchObject({ isAdmin: true, email: 'commish@example.com' });
    hostToken = tokenFrom(res);

    const status = body<{ needsSetup: boolean }>(await call('GET', '/api/auth/status'));
    expect(status.needsSetup).toBe(false);
  });

  it('requires an invite code for everyone after that', async () => {
    const res = await call('POST', '/api/auth/register', {
      body: { email: 'friend@example.com', password: 'hunter2hunter2', displayName: 'Friend' },
    });
    expect(res.statusCode).toBe(400);
    expect(body<{ error: string }>(res).error).toMatch(/invite/i);
  });

  it('mints an invite and spends it exactly once', async () => {
    const minted = await call('POST', '/api/invites', { token: hostToken, body: { days: 30 } });
    expect(minted.statusCode).toBe(200);
    const code = body<{ code: string }>(minted).code;

    const used = await call('POST', '/api/auth/register', {
      body: { email: 'friend@example.com', password: 'hunter2hunter2', displayName: 'Friend', inviteCode: code },
    });
    expect(used.statusCode).toBe(200);
    expect(body<{ user: { isAdmin: boolean } }>(used).user.isAdmin).toBe(false);
    guestToken = tokenFrom(used);

    const again = await call('POST', '/api/auth/register', {
      body: { email: 'third@example.com', password: 'hunter2hunter2', displayName: 'Third', inviteCode: code },
    });
    expect(again.statusCode).toBe(400);

    // Only the commissioner can hand out invites.
    expect((await call('POST', '/api/invites', { token: guestToken, body: {} })).statusCode).toBe(403);
    // Signed-out visitors are turned away.
    expect((await call('GET', '/api/collection')).statusCode).toBe(401);
  });

  it('signs in with the stored password and rejects a wrong one', async () => {
    const ok = await call('POST', '/api/auth/login', { body: { email: 'friend@example.com', password: 'hunter2hunter2' } });
    expect(ok.statusCode).toBe(200);
    expect(body<{ user: { displayName: string } }>(ok).user.displayName).toBe('Friend');

    const bad = await call('POST', '/api/auth/login', { body: { email: 'friend@example.com', password: 'nope-nope-nope' } });
    expect(bad.statusCode).toBe(401);
  });
});

describe('card database and collection', () => {
  it('searches players by name', async () => {
    const res = await call('GET', '/api/people/search?q=willie%20mays', { token: hostToken });
    expect(res.statusCode).toBe(200);
    const found = body<{ people: { nameLast: string; debutYear: number }[] }>(res).people;
    expect(found[0]).toMatchObject({ nameLast: 'Mays', debutYear: 1951 });
  });

  it('previews a card built from the six seasons before its year', async () => {
    const mays = body<{ people: { id: number }[] }>(await call('GET', '/api/people/search?q=Willie%20Mays', { token: hostToken })).people[0]!;
    const res = await call('GET', `/api/cards/preview?personId=${mays.id}&cardYear=1955`, { token: hostToken });
    expect(res.statusCode).toBe(200);
    const card = body<{ card: { seasons: { year: number }[]; positions: string[]; playable: boolean; teamLabel: string } }>(res).card;
    expect(card.seasons.map((s) => s.year)).toEqual([1951, 1952, 1953, 1954]);
    expect(card.positions).toContain('CF');
    expect(card.playable).toBe(true);
  });

  it('adds cards and refuses a year outside the player’s career', async () => {
    const mays = body<{ people: { id: number }[] }>(await call('GET', '/api/people/search?q=Willie%20Mays', { token: hostToken })).people[0]!;
    const ok = await call('POST', '/api/collection', { token: hostToken, body: { personId: mays.id, cardYear: 1955, setLabel: 'Topps' } });
    expect(ok.statusCode).toBe(200);

    const tooEarly = await call('POST', '/api/collection', { token: hostToken, body: { personId: mays.id, cardYear: 1940 } });
    expect(tooEarly.statusCode).toBe(400);
    expect(body<{ error: string }>(tooEarly).error).toMatch(/1952.1974/);

    const list = body<{ cards: { card: { name: string }; setLabel: string }[] }>(await call('GET', '/api/collection', { token: hostToken })).cards;
    expect(list).toHaveLength(1);
    expect(list[0]!.card.name).toBe('Willie Mays');
  });

  it('bumps the copy count instead of stacking a second identical row', async () => {
    const mays = body<{ people: { id: number }[] }>(await call('GET', '/api/people/search?q=Willie%20Mays', { token: hostToken })).people[0]!;
    const second = await call('POST', '/api/collection', { token: hostToken, body: { personId: mays.id, cardYear: 1955, setLabel: 'Topps' } });
    expect(second.statusCode).toBe(200);

    const list = body<{ cards: { id: number; quantity: number; setLabel: string; card: { cardYear: number } }[] }>(
      await call('GET', '/api/collection', { token: hostToken }),
    ).cards;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ quantity: 2, setLabel: 'Topps' });
    expect(body<{ card: { id: number } }>(second).card.id).toBe(list[0]!.id);

    // A different set is a different card, so it gets its own row.
    const otherSet = await call('POST', '/api/collection', {
      token: hostToken,
      body: { personId: mays.id, cardYear: 1955, setLabel: 'Bowman' },
    });
    expect(otherSet.statusCode).toBe(200);
    const after = body<{ cards: { quantity: number }[] }>(await call('GET', '/api/collection', { token: hostToken })).cards;
    expect(after).toHaveLength(2);
    expect(after.map((c) => c.quantity).sort()).toEqual([1, 2]);

    await call('DELETE', `/api/collection/${body<{ card: { id: number } }>(otherSet).card.id}`, { token: hostToken });
  });

  it('uploads a card photo and serves it back to signed-in members', async () => {
    const boundary = '----cardballtest';
    const bytes = Buffer.from('not-really-a-jpeg-but-the-server-only-checks-the-mime-type');
    const head = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="width"',
      '',
      '600',
      `--${boundary}`,
      'Content-Disposition: form-data; name="height"',
      '',
      '840',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="mays.jpg"',
      'Content-Type: image/jpeg',
      '',
      '',
    ].join('\r\n');
    const payload = Buffer.concat([Buffer.from(head, 'utf8'), bytes, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')]);

    const upload = await call('POST', '/api/photos', {
      token: hostToken,
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(upload.statusCode).toBe(200);
    photoId = body<{ photoId: number }>(upload).photoId;

    const fetched = await call('GET', `/api/photos/${photoId}`, { token: guestToken });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers['content-type']).toBe('image/jpeg');
    expect(fetched.rawPayload.equals(bytes)).toBe(true);

    // Anonymous visitors can't pull card photos.
    expect((await call('GET', `/api/photos/${photoId}`)).statusCode).toBe(401);

    // Attach the photo to a card.
    const cards = body<{ cards: { id: number; photoId: number | null }[] }>(await call('GET', '/api/collection', { token: hostToken })).cards;
    const patched = await call('PATCH', `/api/collection/${cards[0]!.id}`, { token: hostToken, body: { photoId } });
    expect(patched.statusCode).toBe(200);
    expect(body<{ card: { photoId: number } }>(patched).card.photoId).toBe(photoId);
  });

  it('rejects a file that is not an image', async () => {
    const boundary = '----cardballbad';
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`,
      'utf8',
    );
    const res = await call('POST', '/api/photos', {
      token: hostToken,
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('teams', () => {
  it('builds a roster and auto-fills a legal lineup for each manager', async () => {
    const host = await buildRoster(hostToken);
    const guest = await buildRoster(guestToken);
    hostTeamId = host.teamId;
    guestTeamId = guest.teamId;
    hostCardIds = host.cardIds;
    guestCardIds = guest.cardIds;

    const view = body<{ team: { roster: unknown[]; lineup: { lineup: string[] } } }>(
      await call('GET', `/api/teams/${hostTeamId}`, { token: hostToken }),
    ).team;
    expect(view.roster).toHaveLength(10);
    expect(view.lineup.lineup).toHaveLength(9);
  });

  it('will not let one manager roster or edit another manager’s cards and teams', async () => {
    const stolen = await call('PUT', `/api/teams/${guestTeamId}/roster`, { token: hostToken, body: { userCardIds: hostCardIds } });
    expect(stolen.statusCode).toBe(404);

    const peek = await call('PUT', `/api/teams/${guestTeamId}/roster`, { token: guestToken, body: { userCardIds: hostCardIds } });
    expect(peek.statusCode).toBe(400);
    expect(body<{ error: string }>(peek).error).toMatch(/own collection/);

    const stranger = await call('GET', `/api/teams/${guestTeamId}`, { token: hostToken });
    expect(stranger.statusCode).toBe(404);
  });
});

describe('house rules', () => {
  it('shows the rules to any signed-in manager and nobody else', async () => {
    expect((await call('GET', '/api/settings/rules')).statusCode).toBe(401);

    const res = await call('GET', '/api/settings/rules', { token: guestToken });
    expect(res.statusCode).toBe(200);
    const rules = body<{ rules: { statWindowSeasons: number; hitBands: { min: number; mod: number }[] } }>(res).rules;
    expect(rules.statWindowSeasons).toBe(6);
    expect(rules.hitBands[0]).toEqual({ min: 0.325, mod: 3 });
  });

  it('only lets the commissioner change them', async () => {
    const current = body<{ rules: unknown }>(await call('GET', '/api/settings/rules', { token: guestToken })).rules;
    const denied = await call('PUT', '/api/settings/rules', { token: guestToken, body: current });
    expect(denied.statusCode).toBe(403);
  });

  it('refuses a rule set with a value out of range', async () => {
    const current = body<{ rules: Record<string, unknown> }>(await call('GET', '/api/settings/rules', { token: hostToken })).rules;
    const bad = await call('PUT', '/api/settings/rules', { token: hostToken, body: { ...current, statWindowSeasons: 0 } });
    expect(bad.statusCode).toBe(400);
    expect(body<{ error: string }>(bad).error).toMatch(/statWindowSeasons/);

    const worse = await call('PUT', '/api/settings/rules', { token: hostToken, body: { ...current, walkBalls: 'three' } });
    expect(worse.statusCode).toBe(400);
  });

  it('applies a saved stat window to the cards the server builds', async () => {
    const current = body<{ rules: Record<string, unknown> }>(await call('GET', '/api/settings/rules', { token: hostToken })).rules;
    const mays = body<{ people: { id: number }[] }>(await call('GET', '/api/people/search?q=Willie%20Mays', { token: hostToken })).people[0]!;

    const saved = await call('PUT', '/api/settings/rules', { token: hostToken, body: { ...current, statWindowSeasons: 2 } });
    expect(saved.statusCode).toBe(200);
    expect(body<{ rules: { statWindowSeasons: number } }>(saved).rules.statWindowSeasons).toBe(2);

    const preview = body<{ card: { seasons: { year: number }[] } }>(
      await call('GET', `/api/cards/preview?personId=${mays.id}&cardYear=1955`, { token: hostToken }),
    ).card;
    expect(preview.seasons.map((s) => s.year)).toEqual([1953, 1954]);

    const restored = await call('PUT', '/api/settings/rules', { token: hostToken, body: current });
    expect(restored.statusCode).toBe(200);
    const back = body<{ card: { seasons: { year: number }[] } }>(
      await call('GET', `/api/cards/preview?personId=${mays.id}&cardYear=1955`, { token: hostToken }),
    ).card;
    expect(back.seasons.map((s) => s.year)).toEqual([1951, 1952, 1953, 1954]);
  });

  it('snapshots the rules into a new game and leaves that game alone afterwards', async () => {
    const current = body<{ rules: Record<string, unknown> }>(await call('GET', '/api/settings/rules', { token: hostToken })).rules;
    await call('PUT', '/api/settings/rules', { token: hostToken, body: { ...current, walkBalls: 5, dpTarget: 25 } });

    const created = await call('POST', '/api/games', {
      token: hostToken,
      body: { mode: 'bot', regulationInnings: 3, teamId: hostTeamId, opponentTeamId: hostTeamId },
    });
    expect(created.statusCode, created.body).toBe(200);
    const gameId = body<{ game: { id: number } }>(created).game.id;

    type Snap = { state: { config: { rules: { walkBalls: number; dpTarget: number } } } };
    const first = body<{ game: Snap }>(await call('GET', `/api/games/${gameId}`, { token: hostToken })).game;
    expect(first.state.config.rules.walkBalls).toBe(5);
    expect(first.state.config.rules.dpTarget).toBe(25);

    // The commissioner changes his mind mid-game.
    await call('PUT', '/api/settings/rules', { token: hostToken, body: { ...current, walkBalls: 2, dpTarget: 40 } });
    const second = body<{ game: Snap }>(await call('GET', `/api/games/${gameId}`, { token: hostToken })).game;
    expect(second.state.config.rules.walkBalls).toBe(5);
    expect(second.state.config.rules.dpTarget).toBe(25);

    await call('DELETE', `/api/games/${gameId}`, { token: hostToken });
    await call('PUT', '/api/settings/rules', { token: hostToken, body: current });
  });

  it('refuses a regulation length the commissioner has taken off the menu', async () => {
    const current = body<{ rules: Record<string, unknown> }>(await call('GET', '/api/settings/rules', { token: hostToken })).rules;
    await call('PUT', '/api/settings/rules', { token: hostToken, body: { ...current, regulationInningsOptions: [3, 6] } });
    const nine = await call('POST', '/api/games', {
      token: hostToken,
      body: { mode: 'bot', regulationInnings: 9, teamId: hostTeamId, opponentTeamId: hostTeamId },
    });
    expect(nine.statusCode).toBe(400);
    expect(body<{ error: string }>(nine).error).toMatch(/regulation/i);

    await call('PUT', '/api/settings/rules', { token: hostToken, body: current });
  });
});

describe('games', () => {
  it('plays a bot game to the final out and records the play-by-play', async () => {
    const created = await call('POST', '/api/games', {
      token: hostToken,
      body: { mode: 'bot', regulationInnings: 3, teamId: hostTeamId, opponentTeamId: hostTeamId },
    });
    expect(created.statusCode).toBe(200);
    const gameId = body<{ game: { id: number } }>(created).game.id;

    const state = await playOut(gameId, hostToken, () => hostToken);
    expect(state.phase).toBe('finished');
    expect(state.winner).not.toBeNull();
    expect(state.home.score).not.toBe(state.away.score);

    const detail = body<{ game: { status: string; version: number }; events: { kind: string; text: string }[] }>(
      await call('GET', `/api/games/${gameId}`, { token: hostToken }),
    );
    expect(detail.game.status).toBe('finished');
    // `version` counts persisted actions, so a 3-inning game can finish in ~10 bumps.
    expect(detail.game.version).toBeGreaterThan(5);
    expect(detail.events.length).toBeGreaterThan(30);
    expect(detail.events.some((e) => e.kind === 'game-over')).toBe(true);

    // A finished bot game can be cleared out of the lobby list.
    expect((await call('DELETE', `/api/games/${gameId}`, { token: hostToken })).statusCode).toBe(200);
  });

  it('runs a remote game with two managers, chat, and a private room', async () => {
    const created = await call('POST', '/api/games', {
      token: hostToken,
      body: { mode: 'remote', regulationInnings: 3, teamId: hostTeamId },
    });
    expect(created.statusCode).toBe(200);
    const gameId = body<{ game: { id: number; status: string } }>(created).game.id;
    expect(body<{ game: { status: string } }>(created).game.status).toBe('open');

    // The guest can see the open game in the lobby list; a stranger cannot see it after it fills.
    const lobby = body<{ games: { id: number; isMine: boolean }[] }>(await call('GET', '/api/games', { token: guestToken })).games;
    expect(lobby.find((g) => g.id === gameId)?.isMine).toBe(false);

    const joined = await call('POST', `/api/games/${gameId}/join`, { token: guestToken, body: { teamId: guestTeamId } });
    expect(joined.statusCode).toBe(200);
    const guestUserId = body<{ game: { guestUserId: number | null } }>(joined).game.guestUserId;
    expect(guestUserId).not.toBeNull();

    // Nobody plays until both managers press play.
    const first = body<{ game: { status: string; ready: string[]; state: GameState } }>(
      await call('POST', `/api/games/${gameId}/actions`, { token: hostToken, body: { action: { type: 'start-game' } } }),
    ).game;
    const hostSide = first.state.home.userId === guestUserId ? 'away' : 'home';
    expect(first).toMatchObject({ status: 'lobby', ready: [hostSide] });

    const chat = await call('POST', `/api/games/${gameId}/chat`, { token: hostToken, body: { body: 'Good luck!' } });
    expect(chat.statusCode).toBe(200);

    // The dice decided who is home, so map each side to its manager's session.
    const state = await playOut(gameId, hostToken, (side, s) => (s[side].userId === guestUserId ? guestToken : hostToken));
    expect(state.phase).toBe('finished');
    expect(state.winner).not.toBeNull();

    const detail = body<{ events: { kind: string }[]; chat: { body: string; name: string }[] }>(
      await call('GET', `/api/games/${gameId}`, { token: guestToken }),
    );
    expect(detail.chat.map((m) => m.body)).toContain('Good luck!');
    expect(detail.events.length).toBeGreaterThan(10);

    // A signed-in stranger cannot read someone else's game.
    const invite = body<{ code: string }>(await call('POST', '/api/invites', { token: hostToken, body: {} })).code;
    const outsider = await call('POST', '/api/auth/register', {
      body: { email: 'nosy@example.com', password: 'hunter2hunter2', displayName: 'Nosy', inviteCode: invite },
    });
    expect(outsider.statusCode).toBe(200);
    const nosyToken = tokenFrom(outsider);
    expect((await call('GET', `/api/games/${gameId}`, { token: nosyToken })).statusCode).toBe(403);
    expect((await call('POST', `/api/games/${gameId}/chat`, { token: nosyToken, body: { body: 'hi' } })).statusCode).toBe(403);
  });

  it('only accepts real Discord links, and makes a remote game concede-only', async () => {    const created = await call('POST', '/api/games', {
      token: hostToken,
      body: { mode: 'remote', regulationInnings: 3, teamId: hostTeamId },
    });
    const gameId = body<{ game: { id: number } }>(created).game.id;

    const bad = await call('PUT', `/api/games/${gameId}/discord`, { token: hostToken, body: { url: 'https://evil.example.com/invite' } });
    expect(bad.statusCode).toBe(400);

    const good = await call('PUT', `/api/games/${gameId}/discord`, { token: hostToken, body: { url: 'https://discord.gg/cardball' } });
    expect(good.statusCode).toBe(200);
    expect(body<{ game: { discordUrl: string } }>(good).game.discordUrl).toBe('https://discord.gg/cardball');

    // Once two managers are in and playing, the host has to concede, not delete.
    const joined = await call('POST', `/api/games/${gameId}/join`, { token: guestToken, body: { teamId: guestTeamId } });
    const guestUserId = body<{ game: { guestUserId: number | null } }>(joined).game.guestUserId;
    await call('POST', `/api/games/${gameId}/actions`, { token: hostToken, body: { action: { type: 'start-game' } } });
    await call('POST', `/api/games/${gameId}/actions`, { token: guestToken, body: { action: { type: 'start-game' } } });

    expect((await call('DELETE', `/api/games/${gameId}`, { token: guestToken })).statusCode).toBe(403);
    expect((await call('DELETE', `/api/games/${gameId}`, { token: hostToken })).statusCode).toBe(400);

    // Whichever side the guest was assigned, conceding hands the win to the other one.
    const before = body<{ game: { state: GameState } }>(await call('GET', `/api/games/${gameId}`, { token: hostToken })).game.state;
    const conceded = await call('POST', `/api/games/${gameId}/actions`, { token: guestToken, body: { action: { type: 'concede' } } });
    expect(conceded.statusCode).toBe(200);
    const after = body<{ game: { state: GameState } }>(conceded).game.state;
    expect(after.endedBy).toBe('concede');
    expect(after.winner).not.toBeNull();
    const loser = before.away.userId === guestUserId ? 'away' : 'home';
    expect(after.winner).toBe(loser === 'away' ? 'home' : 'away');

    // A finished remote game can then be cleared away.
    expect((await call('DELETE', `/api/games/${gameId}`, { token: hostToken })).statusCode).toBe(200);
  });

  it('lets one manager run a hotseat game against themselves', async () => {
    const created = await call('POST', '/api/games', {
      token: hostToken,
      body: { mode: 'hotseat', regulationInnings: 3, teamId: hostTeamId, opponentTeamId: hostTeamId },
    });
    expect(created.statusCode).toBe(200);
    const gameId = body<{ game: { id: number } }>(created).game.id;
    await call('POST', `/api/games/${gameId}/actions`, { token: hostToken, body: { action: { type: 'start-game' } } });

    // One manager controls both sides, so the concede action names the side.
    const conceded = await call('POST', `/api/games/${gameId}/actions`, { token: hostToken, body: { action: { type: 'concede', side: 'away' } } });
    expect(conceded.statusCode).toBe(200);
    expect(body<{ game: { state: { winner: string; endedBy: string } } }>(conceded).game.state).toMatchObject({ winner: 'home', endedBy: 'concede' });
  });
});

describe('match rules', () => {
  /** A team holding just these cards. */
  async function teamOf(token: string, name: string, userCardIds: number[]): Promise<number> {
    const team = body<{ team: { id: number } }>(await call('POST', '/api/teams', { token, body: { name } }));
    const res = await call('PUT', `/api/teams/${team.team.id}/roster`, { token, body: { userCardIds } });
    expect(res.statusCode, res.body).toBe(200);
    return team.team.id;
  }

  /** The host's nine everyday hitters, plus one merely-good pitcher. */
  async function smallBallCardIds(token: string): Promise<number[]> {
    const people = body<{ people: { id: number }[] }>(await call('GET', '/api/people/search?q=Test%20Spare', { token })).people;
    expect(people).toHaveLength(1);
    const spare = body<{ card: { id: number } }>(await call('POST', '/api/collection', { token, body: { personId: people[0]!.id, cardYear: CARD_YEAR } })).card;

    const cards = body<{ cards: { id: number; card: { name: string; canPitch: boolean } }[] }>(await call('GET', '/api/collection', { token })).cards;
    const hitters = cards.filter((c) => !c.card.canPitch && c.card.name.startsWith('Test Hitter')).slice(0, 9);
    expect(hitters).toHaveLength(9);
    return [...hitters.map((c) => c.id), spare.id];
  }

  /** A team of nine uncommon hitters and one uncommon pitcher: no rare cards. */
  async function smallBallTeam(token: string, name: string): Promise<number> {
    const teamId = await teamOf(token, name, await smallBallCardIds(token));
    const auto = await call('POST', `/api/teams/${teamId}/auto-lineup`, { token });
    expect(auto.statusCode, auto.body).toBe(200);
    return teamId;
  }

  it('refuses a roster with a card from outside the era, and names the card', async () => {
    const res = await call('POST', '/api/games', {
      token: hostToken,
      body: { mode: 'hotseat', regulationInnings: 3, teamId: hostTeamId, opponentTeamId: hostTeamId, match: { yearFrom: 1990, yearTo: 1999, rarityCaps: null } },
    });
    expect(res.statusCode).toBe(400);
    const error = body<{ error: string }>(res).error;
    expect(error).toMatch(/1990–1999 only/);
    expect(error).toMatch(new RegExp(`a ${CARD_YEAR} card`));
  });

  it('refuses a roster carrying more rare cards than the match allows', async () => {
    const res = await call('POST', '/api/games', {
      token: hostToken,
      body: { mode: 'hotseat', regulationInnings: 3, teamId: hostTeamId, opponentTeamId: hostTeamId, match: { yearFrom: 2000, yearTo: 2010, rarityCaps: { rare: 0, chase: 0 } } },
    });
    expect(res.statusCode).toBe(400);
    // The one ace on every roster is a rare card.
    expect(body<{ error: string }>(res).error).toMatch(/allows no rare cards/);
  });

  it('refuses an era that runs backwards or spans too long', async () => {
    const backwards = await call('POST', '/api/games', {
      token: hostToken,
      body: { mode: 'hotseat', regulationInnings: 3, teamId: hostTeamId, opponentTeamId: hostTeamId, match: { yearFrom: 1990, yearTo: 1980, rarityCaps: null } },
    });
    expect(backwards.statusCode).toBe(400);
    expect(body<{ error: string }>(backwards).error).toMatch(/end after it starts/i);

    const wide = await call('POST', '/api/games', {
      token: hostToken,
      body: { mode: 'hotseat', regulationInnings: 3, teamId: hostTeamId, opponentTeamId: hostTeamId, match: { yearFrom: 1900, yearTo: 2050, rarityCaps: null } },
    });
    expect(wide.statusCode).toBe(400);
    expect(body<{ error: string }>(wide).error).toMatch(/120 years or fewer/i);
  });

  it('snapshots the match into the game and shows it in the lobby list', async () => {
    const match = { yearFrom: 2001, yearTo: 2010, rarityCaps: { rare: 5, chase: 2 } };
    const created = await call('POST', '/api/games', {
      token: hostToken,
      body: { mode: 'hotseat', regulationInnings: 3, teamId: hostTeamId, opponentTeamId: hostTeamId, match },
    });
    expect(created.statusCode, created.body).toBe(200);
    const game = body<{ game: { id: number; state: { config: { match: unknown } } } }>(created).game;
    expect(game.state.config.match).toEqual(match);

    const listed = body<{ games: { id: number; match: unknown }[] }>(await call('GET', '/api/games', { token: hostToken })).games;
    expect(listed.find((g) => g.id === game.id)?.match).toEqual(match);

    // A game created without match rules plays with the widest possible ones.
    const open = await call('POST', '/api/games', {
      token: hostToken,
      body: { mode: 'hotseat', regulationInnings: 3, teamId: hostTeamId, opponentTeamId: hostTeamId },
    });
    const openGame = body<{ game: { state: { config: { match: { yearFrom: number; yearTo: number; rarityCaps: unknown } } } } }>(open).game;
    expect(openGame.state.config.match).toMatchObject({ yearFrom: 1872, yearTo: 2100, rarityCaps: null });
  });

  it('checks the joining manager against the host’s match', async () => {
    // A team of nothing but uncommon cards passes a no-rare-cards match.
    const hostTeam = await smallBallTeam(hostToken, 'Small Ball');
    const created = await call('POST', '/api/games', {
      token: hostToken,
      body: { mode: 'remote', regulationInnings: 3, teamId: hostTeam, match: { yearFrom: 2000, yearTo: 2010, rarityCaps: { rare: 0, chase: 0 } } },
    });
    expect(created.statusCode, created.body).toBe(200);
    const gameId = body<{ game: { id: number } }>(created).game.id;

    // The guest's regular roster carries a rare ace, so the seat is refused.
    const joined = await call('POST', `/api/games/${gameId}/join`, { token: guestToken, body: { teamId: guestTeamId } });
    expect(joined.statusCode).toBe(400);
    expect(body<{ error: string }>(joined).error).toMatch(/allows no rare cards/);

    // The guest can still take the seat with a team that fits.
    const guestTeam = await smallBallTeam(guestToken, 'Small Ball Too');
    expect((await call('POST', `/api/games/${gameId}/join`, { token: guestToken, body: { teamId: guestTeam } })).statusCode).toBe(200);
  });
});
