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
let db: Db['db'];
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
  await seedBatter(db, {
    bbrefId: `draft${String(n).padStart(2, '0')}`,
    nameLast: `Player${n}`,
    debutYear: 1998,
    finalYear: 2004,
    years: [1998, 1999, 2000, 2001, 2002, 2003],
    homeRuns: 20 + n,
  });
}

/**
 * A starting pitcher with seasons across a card's stat window. An era has to
 * hold one for a draft to open there: every finished draft tops its seats up
 * to a legal lineup out of the same pool.
 */
async function seedStarter(
  db: Db['db'],
  opts: { bbrefId: string; nameLast: string; debutYear: number; finalYear: number; years: number[]; era: number },
): Promise<void> {
  const [person] = await db
    .insert(people)
    .values({
      bbrefId: opts.bbrefId,
      nameFirst: 'Draft',
      nameLast: opts.nameLast,
      bats: 'R',
      throws: 'R',
      debutYear: opts.debutYear,
      finalYear: opts.finalYear,
      isStarter: true,
    })
    .returning({ id: people.id });
  await db.insert(seasons).values(
    opts.years.map((year) => ({
      personId: person!.id,
      year,
      teamLabel: 'TST',
      games: 32,
      ab: 60,
      h: 10,
      avg: 0.167,
      pa: 65,
      pitchGames: 32,
      pitchIpOuts: 620,
      pitchEra: opts.era,
      pitchBf: 850,
      primaryPosition: 'P',
      positionsPlayed: [{ position: 'P' as const, games: 32, rating: 0 }],
    })),
  );
}

/** A batter with exactly the seasons and numbers a test needs. */
async function seedBatter(
  db: Db['db'],
  opts: {
    bbrefId: string;
    nameLast: string;
    debutYear: number;
    finalYear: number;
    years: number[];
    homeRuns: number;
    stolenBases?: number;
    avg?: number;
  },
): Promise<void> {
  const [person] = await db
    .insert(people)
    .values({
      bbrefId: opts.bbrefId,
      nameFirst: 'Draft',
      nameLast: opts.nameLast,
      bats: 'R',
      throws: 'R',
      debutYear: opts.debutYear,
      finalYear: opts.finalYear,
    })
    .returning({ id: people.id });
  await db.insert(seasons).values(
    opts.years.map((year) => ({
      personId: person!.id,
      year,
      teamLabel: 'TST',
      games: 150,
      ab: 500,
      h: Math.round(500 * (opts.avg ?? 0.3)),
      avg: opts.avg ?? 0.3,
      doubles: 25,
      triples: 3,
      homeRuns: opts.homeRuns,
      rbi: 80,
      sb: opts.stolenBases ?? 10,
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

  const { db: conn, sql: sqlConn } = createDb(TEST_URL);
  db = conn;
  sql = sqlConn;
  const tables = await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`;
  if (tables.length) {
    await sql.unsafe(`truncate table ${tables.map((t) => `"${t.tablename}"`).join(', ')} restart identity cascade`);
  }

  for (let i = 1; i <= 30; i++) await seedHitter(db, i);
  // One starter, so the 2004 era can deal a team that takes the field.
  await seedStarter(db, { bbrefId: 'draftsp', nameLast: 'Starter', debutYear: 1998, finalYear: 2004, years: [1998, 1999, 2000, 2001, 2002, 2003], era: 3.5 });

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
  const config = { rounds: 2, packSize: 3, yearFrom: CARD_YEAR, yearTo: CARD_YEAR, playableOnly: true };

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

  it('refuses an era with nobody in its stat windows', async () => {
    const res = await call('POST', '/api/drafts', { token: hostToken, body: { ...config, yearFrom: 1900, yearTo: 1900 } });
    expect(res.statusCode).toBe(400);
    expect(parse<{ error: string }>(res).error).toMatch(/no .* cards to deal/i);
  });

  it('refuses a pack that is not dealt in the era', async () => {
    const res = await call('POST', '/api/drafts', {
      token: hostToken,
      body: { ...config, yearFrom: 1960, yearTo: 1979, themes: ['deadball'] },
    });
    expect(res.statusCode).toBe(400);
    expect(parse<{ error: string }>(res).error).toMatch(/deadball era is not dealt in 1960–1979/i);
  });

  it('refuses an era that runs backwards', async () => {
    const res = await call('POST', '/api/drafts', { token: hostToken, body: { ...config, yearFrom: 1990, yearTo: 1980 } });
    expect(res.statusCode).toBe(400);
    expect(parse<{ error: string }>(res).error).toMatch(/end after it starts/i);
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
    expect(draft.waitingOn).toEqual([0, 1]);
    expect(draft.passDirection).toBe('left');
    expect(draft.iHavePicked).toBe(false);
    expect(draft.myPack).toHaveLength(config.packSize);
    expect(draft.myPack.every((c) => c.cardYear === CARD_YEAR)).toBe(true);
    expect(draft.myPack.every((c) => c.playable)).toBe(true);
    expect(draft.myPackTheme).toBe('mixed');
    expect(draft.myPackOpened).toBe(false);

    expect((await call('POST', `/api/drafts/${draftId}/start`, { token: hostToken })).statusCode).toBe(400);
  });

  let guestOpeningPack: string[] = [];

  it('keeps the pack sealed until its holder tears it open', async () => {
    const sealed = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${draftId}`, { token: hostToken })).draft;
    const peeked = await call('POST', `/api/drafts/${draftId}/pick`, { token: hostToken, body: { cardId: sealed.myPack[0]!.id } });
    expect(peeked.statusCode).toBe(400);
    expect(parse<{ error: string }>(peeked).error).toMatch(/open your pack first/i);

    const opened = await call('POST', `/api/drafts/${draftId}/open`, { token: hostToken });
    expect(opened.statusCode).toBe(200);
    const draft = parse<{ draft: DraftView }>(opened).draft;
    expect(draft.myPackOpened).toBe(true);
    // Opening again is a no-op, not an error.
    expect((await call('POST', `/api/drafts/${draftId}/open`, { token: hostToken })).statusCode).toBe(200);
    // The other seat is still sealed; one manager opening doesn't reveal another's pack.
    const guest = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${draftId}`, { token: guestToken })).draft;
    expect(guest.myPackOpened).toBe(false);
  });

  it('lets managers pick at the same time, but only once per pass', async () => {
    await call('POST', `/api/drafts/${draftId}/open`, { token: guestToken });
    const peek = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${draftId}`, { token: guestToken })).draft;
    guestOpeningPack = peek.myPack.map((c) => c.id);

    const first = await call('POST', `/api/drafts/${draftId}/pick`, { token: guestToken, body: { cardId: peek.myPack[0]!.id } });
    expect(first.statusCode).toBe(200);
    const after = parse<{ draft: DraftView }>(first).draft;
    expect(after.iHavePicked).toBe(true);
    expect(after.waitingOn).toEqual([0]);
    // Nothing passes until the host picks too.
    expect(after.myPack).toHaveLength(config.packSize - 1);

    const again = await call('POST', `/api/drafts/${draftId}/pick`, { token: guestToken, body: { cardId: peek.myPack[1]!.id } });
    expect(again.statusCode).toBe(400);
    expect(parse<{ error: string }>(again).error).toMatch(/already took a card/i);
  });

  it('rejects a card that is not in the pack', async () => {
    const res = await call('POST', `/api/drafts/${draftId}/pick`, { token: hostToken, body: { cardId: 'not-a-card' } });
    expect(res.statusCode).toBe(400);
    expect(parse<{ error: string }>(res).error).toMatch(/not in your pack/i);
  });

  it('passes every pack once everyone has picked, and files the card in the collection', async () => {
    const before = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${draftId}`, { token: hostToken })).draft;
    const taken = before.myPack[0]!;

    const res = await call('POST', `/api/drafts/${draftId}/pick`, { token: hostToken, body: { cardId: taken.id } });
    expect(res.statusCode).toBe(200);
    const draft = parse<{ draft: DraftView }>(res).draft;

    expect(draft.myPicks.map((c) => c.id)).toEqual([taken.id]);
    expect(draft.waitingOn).toEqual([0, 1]);
    expect(draft.iHavePicked).toBe(false);
    // The host now holds the guest's leftovers…
    expect(draft.myPack.map((c) => c.id).sort()).toEqual(guestOpeningPack.slice(1).sort());

    // …and the guest holds the host's.
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

    const directions = new Set<string>();

    for (let pass = 0; pass < totalPicks && !finished; pass++) {
      const view = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${draftId}`, { token: hostToken })).draft;
      if (view.phase === 'finished') {
        finished = view;
        break;
      }
      directions.add(view.passDirection);
      // Guest first this time, to show the order within a pass doesn't matter.
      for (const seat of [...view.waitingOn].reverse()) {
        const token = tokens[seat]!;
        expect((await call('POST', `/api/drafts/${draftId}/open`, { token })).statusCode).toBe(200);
        const mine = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${draftId}`, { token })).draft;
        const card = mine.myPack[0];
        expect(card, `seat ${seat} should be holding cards`).toBeDefined();
        const res = await call('POST', `/api/drafts/${draftId}/pick`, { token, body: { cardId: card!.id } });
        expect(res.statusCode, res.body).toBe(200);
        picks++;
      }
    }

    const final = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${draftId}`, { token: hostToken })).draft;
    expect(final.phase).toBe('finished');
    expect(directions).toEqual(new Set(['left', 'right']));
    // The previous two tests made the opening pass.
    expect(picks).toBe(totalPicks - 2);
    // Field insurance tops each seat up to a legal lineup, so a seat may hold
    // more cards than it picked.
    expect(final.myPicks.length).toBeGreaterThanOrEqual(config.rounds * config.packSize);
    expect(final.pickCounts['0']).toBeGreaterThanOrEqual(config.rounds * config.packSize);
    expect(final.pickCounts['1']).toBeGreaterThanOrEqual(config.rounds * config.packSize);
    expect(final.log.some((l) => /draft complete/i.test(l.text))).toBe(true);
  });

  it('hands every drafted card to the collection', async () => {
    const expected = config.rounds * config.packSize;
    for (const token of [hostToken, guestToken]) {
      const cards = parse<{ cards: { quantity: number }[] }>(await call('GET', '/api/collection', { token })).cards;
      expect(cards.length).toBeGreaterThan(0);
      // The same player can come around in a later pack; that copy bumps the
      // count on the row instead of stacking a duplicate. Field insurance
      // cards land in the collection like any pick, so copies can exceed the
      // six picked cards.
      const copies = cards.reduce((sum, card) => sum + card.quantity, 0);
      expect(copies).toBeGreaterThanOrEqual(expected);
      expect(cards.length).toBeLessThanOrEqual(copies);
    }
  });

  it('tops every seat up to a legal lineup when the last pack empties', async () => {
    const invite = parse<{ code: string }>(await call('POST', '/api/invites', { token: hostToken, body: {} })).code;
    const thirdToken = await register('insured@example.com', 'Insured', invite);
    const tokens = [hostToken, guestToken, thirdToken];
    // Three cards each: every seat is guaranteed short of nine bats and a
    // starter, whatever the deal hands them, so insurance always fires.
    const body = { rounds: 1, packSize: 3, yearFrom: CARD_YEAR, yearTo: CARD_YEAR, playableOnly: true };
    const room = parse<{ draft: DraftView }>(await call('POST', '/api/drafts', { token: hostToken, body })).draft;
    for (const token of tokens.slice(1)) await call('POST', `/api/drafts/${room.id}/join`, { token });
    await call('POST', `/api/drafts/${room.id}/start`, { token: hostToken });

    for (let guard = 0; guard < 100; guard++) {
      const view = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${room.id}`, { token: hostToken })).draft;
      if (view.phase === 'finished') break;
      for (const seat of view.waitingOn) {
        const token = tokens[seat]!;
        expect((await call('POST', `/api/drafts/${room.id}/open`, { token })).statusCode, `seat ${seat}`).toBe(200);
        const mine = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${room.id}`, { token })).draft;
        expect(mine.myPack.length, `seat ${seat} should be holding cards`).toBeGreaterThan(0);
        expect((await call('POST', `/api/drafts/${room.id}/pick`, { token, body: { cardId: mine.myPack[0]!.id } })).statusCode).toBe(200);
      }
    }

    for (const token of tokens) {
      const done = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${room.id}`, { token })).draft;
      expect(done.phase).toBe('finished');
      // Nine distinct bats plus a starter who is none of them — the engine's
      // own rule — whatever the seat picked from its three cards.
      const distinct = new Map(done.myPicks.map((p) => [p.personId, p]));
      const bats = [...distinct.values()].filter((c) => c.playable && (c.positions?.length ?? 0) > 0 && !c.starter);
      const starters = [...distinct.values()].filter((c) => c.playable && c.starter);
      expect(bats.length).toBeGreaterThanOrEqual(9);
      expect(starters.length).toBeGreaterThanOrEqual(1);
      // And the league says so in the log.
      expect(done.log.some((l) => /field insurance/i.test(l.text))).toBe(true);
    }
  });

  it('passes left in the first pack and right in the second', async () => {
    const invite = parse<{ code: string }>(await call('POST', '/api/invites', { token: hostToken, body: {} })).code;
    const thirdToken = await register('third@example.com', 'Third', invite);
    const tokens = [hostToken, guestToken, thirdToken];
    const three = { rounds: 2, packSize: 3, yearFrom: CARD_YEAR, yearTo: CARD_YEAR, playableOnly: true };

    const room = parse<{ draft: DraftView }>(await call('POST', '/api/drafts', { token: hostToken, body: three })).draft;
    await call('POST', `/api/drafts/${room.id}/join`, { token: guestToken });
    await call('POST', `/api/drafts/${room.id}/join`, { token: thirdToken });
    await call('POST', `/api/drafts/${room.id}/start`, { token: hostToken });

    const view = async (seat: number) =>
      parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${room.id}`, { token: tokens[seat]! })).draft;

    /** Everyone tears open and takes their first card; returns what each seat had left over. */
    async function onePass(): Promise<string[][]> {
      const leftovers: string[][] = [];
      for (let seat = 0; seat < 3; seat++) {
        expect((await call('POST', `/api/drafts/${room.id}/open`, { token: tokens[seat]! })).statusCode).toBe(200);
        const pack = (await view(seat)).myPack;
        leftovers.push(pack.slice(1).map((c) => c.id).sort());
        expect((await call('POST', `/api/drafts/${room.id}/pick`, { token: tokens[seat]!, body: { cardId: pack[0]!.id } })).statusCode).toBe(200);
      }
      return leftovers;
    }
    const holding = async (seat: number) => (await view(seat)).myPack.map((c) => c.id).sort();

    // Pack 1 passes left: seat s receives seat s-1's leftovers.
    let left = await onePass();
    for (let seat = 0; seat < 3; seat++) expect(await holding(seat)).toEqual(left[(seat + 2) % 3]);
    // A passed pack comes back sealed: the new holder has to tear it open again.
    expect((await view(0)).myPackOpened).toBe(false);
    await onePass();
    await onePass();

    const second = await view(0);
    expect(second.round).toBe(2);
    expect(second.passDirection).toBe('right');
    // Pack 2 passes right: seat s receives seat s+1's leftovers.
    left = await onePass();
    for (let seat = 0; seat < 3; seat++) expect(await holding(seat)).toEqual(left[(seat + 1) % 3]);
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

/**
 * Two tiny, deliberately narrow pools, so a pack's contents are known exactly:
 * one where every card is a slugger, and one where only some are.
 */
const SLUGGER_YEAR = 1976;
const CAP_YEAR = 1966;

describe('themed packs and draft rules', () => {
  let sluggers: string[] = [];
  let token = '';
  let other = '';

  beforeAll(async () => {
    // Only these five have 30-homer seasons in 1970–1975, so a slugger pack
    // from 1976 is exactly them.
    for (const [i, hr] of [35, 33, 31, 12, 8].entries()) {
      await seedBatter(db, {
        bbrefId: `theme${i}`,
        nameLast: `Themed${i}`,
        debutYear: 1969,
        finalYear: 1975,
        years: [1970, 1971, 1972, 1973, 1974, 1975],
        homeRuns: hr,
      });
    }
    // Four more bats and a starter in the same window, so the 1976 era can
    // deal a team that takes the field: a draft refuses an era that cannot.
    for (const [i, hr] of [10, 10, 10, 10].entries()) {
      await seedBatter(db, {
        bbrefId: `themebat${i}`,
        nameLast: `ThemeBat${i}`,
        debutYear: 1969,
        finalYear: 1975,
        years: [1970, 1971, 1972, 1973, 1974, 1975],
        homeRuns: hr,
      });
    }
    await seedStarter(db, { bbrefId: 'themesp', nameLast: 'ThemeStarter', debutYear: 1969, finalYear: 1975, years: [1970, 1971, 1972, 1973, 1974, 1975], era: 3.5 });
    // Three rare bats in 1960–1965, for the cap: HR 30+ makes every one rare.
    for (const [i, hr] of [35, 33, 31].entries()) {
      await seedBatter(db, {
        bbrefId: `cap${i}`,
        nameLast: `Capped${i}`,
        debutYear: 1959,
        finalYear: 1965,
        years: [1960, 1961, 1962, 1963, 1964, 1965],
        homeRuns: hr,
      });
    }
    // Six more rare bats and a rare starter in 1960–1965, for the cap: HR 30+
    // and a 3.00 ERA make every card in the pool rare, and the era fieldable.
    for (const [i, hr] of [30, 30, 30, 30, 30, 30].entries()) {
      await seedBatter(db, {
        bbrefId: `capbat${i}`,
        nameLast: `CapBat${i}`,
        debutYear: 1959,
        finalYear: 1965,
        years: [1960, 1961, 1962, 1963, 1964, 1965],
        homeRuns: hr,
      });
    }
    await seedStarter(db, { bbrefId: 'capsp', nameLast: 'CapStarter', debutYear: 1959, finalYear: 1965, years: [1960, 1961, 1962, 1963, 1964, 1965], era: 3.0 });
    sluggers = ['Draft Themed0', 'Draft Themed1', 'Draft Themed2'];

    // The app is invite-only once the first manager exists; the first describe
    // block registered that manager, so mint seats from their account.
    const first = parse<{ code: string }>(await call('POST', '/api/invites', { token: hostToken, body: {} })).code;
    token = await register('themes@example.com', 'Themer', first);
    const second = parse<{ code: string }>(await call('POST', '/api/invites', { token: hostToken, body: {} })).code;
    other = await register('capped@example.com', 'Capped', second);
  });

  /** Open a two-seat room, seat the second manager, and deal the packs. */
  async function dealtRoom(body: Record<string, unknown>): Promise<DraftView> {
    const res = await call('POST', '/api/drafts', { token, body });
    expect(res.statusCode, res.body).toBe(200);
    const room = parse<{ draft: DraftView }>(res).draft;
    expect((await call('POST', `/api/drafts/${room.id}/join`, { token: other })).statusCode).toBe(200);
    const started = await call('POST', `/api/drafts/${room.id}/start`, { token });
    expect(started.statusCode, started.body).toBe(200);
    return parse<{ draft: DraftView }>(started).draft;
  }

  it('deals only cards that fit the wrapper label', async () => {
    const draft = await dealtRoom({
      rounds: 1,
      packSize: 3,
      yearFrom: SLUGGER_YEAR,
      yearTo: SLUGGER_YEAR,
      playableOnly: true,
      themes: ['sluggers'],
    });

    expect(draft.myPack).toHaveLength(3);
    expect(draft.myPack.map((c) => c.name).sort()).toEqual([...sluggers].sort());
    expect(draft.myPack.every((c) => c.rarity === 'rare')).toBe(true);
    expect(draft.myPackTheme).toBe('sluggers');
  });

  it('deals from the whole pool for a mixed pack', async () => {
    const draft = await dealtRoom({
      rounds: 1,
      packSize: 3,
      yearFrom: SLUGGER_YEAR,
      yearTo: SLUGGER_YEAR,
      playableOnly: true,
      themes: ['mixed'],
    });

    expect(draft.myPack).toHaveLength(3);
    expect(draft.myPack.every((c) => c.cardYear === SLUGGER_YEAR)).toBe(true);
    // A mixed pack may hold any of the era's ten players, not just the sluggers.
    const pool = new Set([
      'Draft Themed0',
      'Draft Themed1',
      'Draft Themed2',
      'Draft Themed3',
      'Draft Themed4',
      'Draft ThemeBat0',
      'Draft ThemeBat1',
      'Draft ThemeBat2',
      'Draft ThemeBat3',
      'Draft ThemeStarter',
    ]);
    expect(draft.myPack.every((c) => pool.has(c.name))).toBe(true);
    expect(draft.myPackTheme).toBe('mixed');
  });

  it('falls back to a mixed pack when the host names a theme that does not exist', async () => {
    const draft = await dealtRoom({
      rounds: 1,
      packSize: 3,
      yearFrom: SLUGGER_YEAR,
      yearTo: SLUGGER_YEAR,
      playableOnly: true,
      themes: ['nonsense'],
    });
    expect(draft.config.themes).toEqual(['mixed']);
  });

  it('caps how many rare cards one manager may take', async () => {
    const draft = await dealtRoom({
      rounds: 1,
      packSize: 3,
      yearFrom: CAP_YEAR,
      yearTo: CAP_YEAR,
      playableOnly: true,
      themes: ['mixed'],
      rarityCaps: { rare: 1, chase: 0 },
    });
    const roomId = draft.id;
    expect(draft.config.rarityCaps).toEqual({ rare: 1, chase: 20 });

    // Everyone in this pool is rare, so the first pick uses up the allowance.
    await call('POST', `/api/drafts/${roomId}/open`, { token });
    const mine = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${roomId}`, { token })).draft;
    expect(mine.myPack.every((c) => c.rarity === 'rare')).toBe(true);
    const first = await call('POST', `/api/drafts/${roomId}/pick`, { token, body: { cardId: mine.myPack[0]!.id } });
    expect(first.statusCode, first.body).toBe(200);
    expect(parse<{ draft: DraftView }>(first).draft.myTally).toEqual({ rare: 1, chase: 0 });

    // The other seat takes one, so the packs pass back around.
    await call('POST', `/api/drafts/${roomId}/open`, { token: other });
    const theirs = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${roomId}`, { token: other })).draft;
    await call('POST', `/api/drafts/${roomId}/pick`, { token: other, body: { cardId: theirs.myPack[0]!.id } });

    await call('POST', `/api/drafts/${roomId}/open`, { token });
    const passed = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${roomId}`, { token })).draft;
    expect(passed.myPack.length).toBeGreaterThan(0);
    const blocked = await call('POST', `/api/drafts/${roomId}/pick`, { token, body: { cardId: passed.myPack[0]!.id } });
    expect(blocked.statusCode).toBe(400);
    expect(parse<{ error: string }>(blocked).error).toMatch(/already have 1 rare card/i);
  });
});
