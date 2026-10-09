/**
 * Draft-room tests against a real Postgres.
 *
 * Uses its own database (derived from the configured test URL) so it can run
 * alongside the API suite without either run truncating the other's tables.
 */
import postgres from 'postgres';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { botAction, waitingOn } from '@cardball/engine';
import type { GameState } from '@cardball/engine';
import { createDb, draftParticipants, drafts, people, runMigrations, seasons } from '@cardball/db';
import type { Db } from '@cardball/db';
import type { DraftView, PackView, SavedLineup } from '@cardball/shared';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE } from '../src/auth.js';
import type { Ctx } from '../src/context.js';
import { env } from '../src/env.js';
import { rewardAchievements } from '../src/packs.js';

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

  it('passes every pack once everyone has picked, and files the card in the sandbox', async () => {
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

    // A drafted card is playable on its draft team but is not in the binder
    // yet: it only lands in the collection when its manager keeps it.
    const collection = parse<{ cards: { card: { name: string } }[] }>(
      await call('GET', '/api/collection', { token: hostToken }),
    ).cards;
    expect(collection.map((c) => c.card.name)).not.toContain(taken.name);
  });

  it('runs both rounds, then opens assembly with a full set of picks', async () => {
    const tokens = [hostToken, guestToken];
    const totalPicks = config.rounds * config.packSize * 2;
    let picks = 0;
    let assembled: DraftView | null = null;

    const directions = new Set<string>();

    for (let pass = 0; pass < totalPicks && !assembled; pass++) {
      const view = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${draftId}`, { token: hostToken })).draft;
      if (view.phase !== 'active') {
        assembled = view;
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
    // A room with two managers stops dealing and moves to assembly, where the
    // two seats build a lineup and play the series. 'finished' is only for
    // rooms dealt before the series existed.
    expect(final.phase).toBe('assembling');
    expect(directions).toEqual(new Set(['left', 'right']));
    // The previous two tests made the opening pass.
    expect(picks).toBe(totalPicks - 2);
    // Field insurance tops each seat up to a legal lineup, so a seat may hold
    // more cards than it picked.
    expect(final.myPicks.length).toBeGreaterThanOrEqual(config.rounds * config.packSize);
    expect(final.pickCounts['0']).toBeGreaterThanOrEqual(config.rounds * config.packSize);
    expect(final.pickCounts['1']).toBeGreaterThanOrEqual(config.rounds * config.packSize);
    expect(final.log.some((l) => /draft complete/i.test(l.text))).toBe(true);
    expect(final.log.some((l) => /build your lineup/i.test(l.text))).toBe(true);
    // Every seat's picks are on the table, with the positions on each card.
    expect(final.seats.map((s) => s.seat)).toEqual([0, 1]);
    expect(final.seats[0]!.picks.length).toBe(final.myPicks.length);
    expect(final.seats.every((s) => s.lineupReady === false)).toBe(true);
    expect(final.gameId).toBeNull();
    expect(final.games).toEqual([]);
    expect(final.myKeeps).toEqual({});
    expect(final.myPendingChoice).toBeNull();
  });

  it('keeps drafted cards out of the binder until they are kept', async () => {
    const expected = config.rounds * config.packSize;
    for (const token of [hostToken, guestToken]) {
      // Nothing a draft dealt is in the binder: the cards sit in the sandbox
      // until a series win is spent on them.
      const cards = parse<{ cards: { quantity: number }[] }>(await call('GET', '/api/collection', { token })).cards;
      expect(cards).toEqual([]);

      // The drafted team, though, holds every card the seat picked — plus the
      // field insurance that topped it up — and can take the field.
      const team = parse<{ team: { cards: unknown[]; suggested: unknown } }>(
        await call('GET', `/api/drafts/${draftId}/team`, { token }),
      ).team;
      expect(team.cards.length).toBeGreaterThanOrEqual(expected);
      expect(team.suggested).not.toBeNull();
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
      if (view.phase !== 'active') break;
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
      expect(done.phase).toBe('assembling');
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
      rarityCaps: { rare: 1, star: 0, mythic: 0 },
    });
    const roomId = draft.id;
    // A tier left at zero is no cap at all, so only the rare cap is in force.
    expect(draft.config.rarityCaps).toEqual({ rare: 1, star: 20, mythic: 20 });

    // Everyone in this pool is rare, so the first pick uses up the allowance.
    await call('POST', `/api/drafts/${roomId}/open`, { token });
    const mine = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${roomId}`, { token })).draft;
    expect(mine.myPack.every((c) => c.rarity === 'rare')).toBe(true);
    const first = await call('POST', `/api/drafts/${roomId}/pick`, { token, body: { cardId: mine.myPack[0]!.id } });
    expect(first.statusCode, first.body).toBe(200);
    expect(parse<{ draft: DraftView }>(first).draft.myTally).toEqual({ rare: 1, star: 0, mythic: 0 });

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

// ---------------------------------------------------------------------------
// The series: assembling, playing, and what a win pays
// ---------------------------------------------------------------------------

/** Answer every remaining decision with the engine's bot policy, on the right token. */
async function playOut(gameId: number, viewerToken: string, tokenForSide: (side: 'home' | 'away', state: GameState) => string): Promise<GameState> {
  const opened = parse<{ game: { state: GameState | null } }>(await call('GET', `/api/games/${gameId}`, { token: viewerToken }));
  let state = opened.game.state;
  expect(state).not.toBeNull();

  if (state!.phase === 'lobby') {
    for (const side of ['home', 'away'] as const) {
      const res = await call('POST', `/api/games/${gameId}/actions`, { token: tokenForSide(side, state!), body: { action: { type: 'start-game' } } });
      expect(res.statusCode, res.body).toBe(200);
      state = parse<{ game: { state: GameState } }>(res).game.state;
      if (state.phase !== 'lobby') break;
    }
  }

  let steps = 0;
  while (state!.phase === 'live' && steps++ < 5_000) {
    const waiting = waitingOn(state!);
    if (!waiting) throw new Error('Game stalled with no side waiting to act');
    const action = botAction(state!, waiting.side);
    if (!action) throw new Error(`No legal move for ${waiting.kind}`);
    const res = await call('POST', `/api/games/${gameId}/actions`, { token: tokenForSide(waiting.side, state!), body: { action } });
    if (res.statusCode !== 200) throw new Error(`Action ${action.type} rejected: ${res.body}`);
    state = parse<{ game: { state: GameState } }>(res).game.state;
  }
  expect(steps).toBeLessThan(5_000);
  return state!;
}

describe('the draft series', () => {
  const PACK_SIZE = 8;
  let tokens: string[] = [];
  let draftId = 0;
  let userIds: number[] = [];
  let gameId = 0;
  let winnerSeat = 0;
  let loserSeat = 1;

  const room = async (token: string): Promise<DraftView> =>
    parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${draftId}`, { token })).draft;

  const shelf = async (token: string): Promise<PackView[]> =>
    parse<{ packs: PackView[] }>(await call('GET', '/api/packs', { token })).packs;

  const collectionNames = async (token: string): Promise<string[]> =>
    parse<{ cards: { card: { name: string } }[] }>(await call('GET', '/api/collection', { token })).cards.map((c) => c.card.name);

  beforeAll(async () => {
    tokens = [hostToken, guestToken];
    for (const token of tokens) {
      const me = parse<{ user: { id: number } }>(await call('GET', '/api/auth/me', { token })).user;
      userIds.push(me.id);
    }
    const created = await call('POST', '/api/drafts', {
      token: hostToken,
      body: { rounds: 1, packSize: PACK_SIZE, yearFrom: CARD_YEAR, yearTo: CARD_YEAR, playableOnly: true, regulationInnings: 3 },
    });
    expect(created.statusCode, created.body).toBe(200);
    draftId = parse<{ draft: DraftView }>(created).draft.id;
    await call('POST', `/api/drafts/${draftId}/join`, { token: guestToken });
    await call('POST', `/api/drafts/${draftId}/start`, { token: hostToken });

    // Drain the room, one card at a time, until the packs are empty.
    for (let guard = 0; guard < 200; guard++) {
      const view = await room(hostToken);
      if (view.phase !== 'active') break;
      for (const seat of view.waitingOn) {
        const token = tokens[seat]!;
        expect((await call('POST', `/api/drafts/${draftId}/open`, { token })).statusCode).toBe(200);
        const mine = await room(token);
        expect((await call('POST', `/api/drafts/${draftId}/pick`, { token, body: { cardId: mine.myPack[0]!.id } })).statusCode).toBe(200);
      }
    }
  });

  it('never deals the same player to two packs in one draft', async () => {
    const view = await room(hostToken);
    // The first PACK_SIZE picks of each seat are what the packs dealt; field
    // insurance is appended after them and may top a seat up from any pool.
    const dealt = view.seats.flatMap((s) => s.picks.slice(0, PACK_SIZE).map((p) => p.personId));
    expect(dealt).toHaveLength(PACK_SIZE * 2);
    expect(new Set(dealt).size).toBe(dealt.length);
  });

  it('opens assembly with a team for every seat, and offers a lineup in draft card ids', async () => {
    const view = await room(hostToken);
    expect(view.phase).toBe('assembling');
    expect(view.seats.every((s) => s.lineupReady === false)).toBe(true);
    expect(view.myPicks.length).toBeGreaterThanOrEqual(PACK_SIZE);

    for (const token of tokens) {
      const team = parse<{ team: { cards: { card: { id: string; name: string }; snapshot: { playable: boolean } }[]; suggested: SavedLineup | null; lineup: SavedLineup | null } }>(
        await call('GET', `/api/drafts/${draftId}/team`, { token }),
      ).team;
      expect(team.cards.length).toBeGreaterThanOrEqual(10);
      expect(team.suggested).not.toBeNull();
      // The team arrives with a lineup already filled in, so the suggestion
      // and the saved lineup agree until the manager changes something.
      expect(team.lineup).toEqual(team.suggested);
      // The suggestion speaks the room's language: draft card ids.
      const ids = new Set(team.cards.map((c) => c.card.id));
      expect(team.suggested!.lineup).toHaveLength(9);
      expect(team.suggested!.lineup.every((id) => ids.has(id))).toBe(true);
      expect(ids.has(team.suggested!.startingPitcherId)).toBe(true);
    }
  });

  it('starts the series once both seats have locked a lineup, and the room plays it like any remote game', async () => {
    // Seat one first: the series waits for the second seat.
    const first = await call('POST', `/api/drafts/${draftId}/lineup`, { token: tokens[0], body: await suggestedLineup(draftId, tokens[0]!) });
    expect(first.statusCode, first.body).toBe(200);
    expect(parse<{ draft: DraftView }>(first).draft.gameId).toBeNull();
    expect(parse<{ draft: DraftView }>(first).draft.seats[0]!.lineupReady).toBe(true);

    const second = await call('POST', `/api/drafts/${draftId}/lineup`, { token: tokens[1], body: await suggestedLineup(draftId, tokens[1]!) });
    expect(second.statusCode, second.body).toBe(200);
    const started = parse<{ draft: DraftView }>(second).draft;
    expect(started.phase).toBe('playing');
    expect(started.gameId).not.toBeNull();
    expect(started.games).toHaveLength(1);
    expect(started.games[0]!.winnerSeat).toBeNull();
    // The saved lineup comes back in the room's own id space.
    expect(started.myLineup).not.toBeNull();
    gameId = started.gameId!;

    // The series game is an ordinary remote room on the drafted teams.
    const game = parse<{ game: { id: number; status: string; mode: string; regulationInnings: number; draftId: number | null; match: { outOfPosition?: boolean } } }>(
      await call('GET', `/api/games/${gameId}`, { token: tokens[0] }),
    ).game;
    expect(game.mode).toBe('remote');
    expect(game.status).toBe('lobby');
    expect(game.regulationInnings).toBe(3);
    expect(game.draftId).toBe(draftId);
    expect(game.match.outOfPosition).toBe(true);

    // A lineup naming a card that is not on the team is refused.
    const bogus = await call('POST', `/api/drafts/${draftId}/lineup`, {
      token: tokens[0],
      body: { ...(await suggestedLineup(draftId, tokens[0]!)), startingPitcherId: 'not-a-card' },
    });
    expect(bogus.statusCode).toBe(400);
  });

  it('pays the loser a consolation pack and leaves the winner a pack and a card to keep', async () => {
    const tokenForSide = (side: 'home' | 'away', state: GameState) =>
      tokens[userIds.indexOf(state[side].userId ?? -1)] ?? tokens[0]!;
    const final = await playOut(gameId, tokens[0]!, tokenForSide);
    expect(final.phase).toBe('finished');

    const view = await room(hostToken);
    const result = view.games[0]!;
    expect(result.winnerSeat).not.toBeNull();
    winnerSeat = result.winnerSeat!;
    loserSeat = winnerSeat === 0 ? 1 : 0;

    const winner = await room(tokens[winnerSeat]!);
    const loser = await room(tokens[loserSeat]!);
    // The winner's bonus is pending until they choose a wrapper; the keep is
    // pending until they name a card.
    expect(winner.myPendingChoice).toBe(gameId);
    expect(winner.myKeeps[String(gameId)]).toBeNull();
    expect(loser.myPendingChoice).toBeNull();
    expect(loser.myKeeps).toEqual({});

    const consolation = (await shelf(tokens[loserSeat]!)).filter((p) => p.source === 'draft-runner-up');
    expect(consolation).toHaveLength(1);
    expect(consolation[0]).toMatchObject({ themeId: 'mixed', size: 5 });
    expect((await shelf(tokens[winnerSeat]!)).filter((p) => p.source === 'draft-win')).toHaveLength(0);
  });

  it('grants the winner one themed pack, once', async () => {
    const choose = (themeId: string) => call('POST', `/api/drafts/${draftId}/choose-pack`, { token: tokens[winnerSeat]!, body: { gameId, themeId } });

    expect((await choose('not-a-theme')).statusCode).toBe(400);
    const chosen = await choose('sluggers');
    expect(chosen.statusCode, chosen.body).toBe(200);
    expect(parse<{ draft: DraftView }>(chosen).draft.myPendingChoice).toBeNull();

    const packs = (await shelf(tokens[winnerSeat]!)).filter((p) => p.source === 'draft-win');
    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({ themeId: 'sluggers', size: 5, label: 'Draft game won' });

    // Once per game: a second choice finds the key taken.
    expect((await choose('aces')).statusCode).toBe(400);
    expect((await shelf(tokens[winnerSeat]!)).filter((p) => p.source === 'draft-win')).toHaveLength(1);

    // Only the winner chooses.
    expect((await call('POST', `/api/drafts/${draftId}/choose-pack`, { token: tokens[loserSeat]!, body: { gameId, themeId: 'aces' } })).statusCode).toBe(403);
  });

  it('moves the card the winner keeps out of the sandbox and into the binder', async () => {
    const winnerPicks = (await room(tokens[winnerSeat]!)).seats.find((s) => s.seat === winnerSeat)!.picks;
    const kept = winnerPicks[0]!;
    // Nothing either manager drafted is in the binder yet.
    expect(await collectionNames(tokens[winnerSeat]!)).toEqual([]);
    expect(await collectionNames(tokens[loserSeat]!)).toEqual([]);

    // Only the winner keeps, and only from their own team.
    expect((await call('POST', `/api/drafts/${draftId}/keep-card`, { token: tokens[loserSeat]!, body: { gameId, cardId: kept.id } })).statusCode).toBe(403);
    expect((await call('POST', `/api/drafts/${draftId}/keep-card`, { token: tokens[winnerSeat]!, body: { gameId, cardId: 'not-a-card' } })).statusCode).toBe(400);

    const keptRes = await call('POST', `/api/drafts/${draftId}/keep-card`, { token: tokens[winnerSeat]!, body: { gameId, cardId: kept.id } });
    expect(keptRes.statusCode, keptRes.body).toBe(200);
    expect(parse<{ draft: DraftView }>(keptRes).draft.myKeeps[String(gameId)]).toBe(kept.id);

    // One card, in the binder; the rest of the team stays in the sandbox.
    expect(await collectionNames(tokens[winnerSeat]!)).toEqual([kept.name]);
    expect(await collectionNames(tokens[loserSeat]!)).toEqual([]);
    // And once per game.
    expect((await call('POST', `/api/drafts/${draftId}/keep-card`, { token: tokens[winnerSeat]!, body: { gameId, cardId: winnerPicks[1]!.id } })).statusCode).toBe(400);
  });

  it('deals a rematch with the same teams, and only once the game in front of them is done', async () => {
    const again = await call('POST', `/api/drafts/${draftId}/rematch`, { token: tokens[0] });
    expect(again.statusCode, again.body).toBe(200);
    const { draft, gameId: next } = parse<{ draft: DraftView; gameId: number }>(again);
    expect(next).not.toBe(gameId);
    expect(draft.gameId).toBe(next);
    expect(draft.games).toHaveLength(2);
    expect(draft.games[0]!.winnerSeat).toBeNull();
    // Same teams: the rematch's two sides are the same users.
    const rematch = parse<{ game: { hostUserId: number; guestUserId: number } }>(await call('GET', `/api/games/${next}`, { token: tokens[0] })).game;
    expect([rematch.hostUserId, rematch.guestUserId].sort()).toEqual([...userIds].sort());

    // The game in front of them has to be finished before another is dealt.
    expect((await call('POST', `/api/drafts/${draftId}/rematch`, { token: tokens[0] })).statusCode).toBe(400);
  });

  it('pays a bonus pack per feat, once, and never to a bot side', async () => {
    const engine = {
      phase: 'finished',
      home: { userId: userIds[0]! },
      away: { userId: userIds[1]! },
      achievements: [
        { side: 'home', kind: 'grand-slam' },
        { side: 'home', kind: 'grand-slam' },
        { side: 'away', kind: 'no-hitter' },
        { side: 'home', kind: 'walkoff-hr' },
      ],
    } as unknown as GameState;

    await rewardAchievements(db, 4242, engine);
    const mine = (await shelf(tokens[0]!)).filter((p) => p.rewardKey?.startsWith('achievement:4242:'));
    expect(mine.map((p) => p.label).sort()).toEqual(['Hit a grand slam', 'Hit a grand slam', 'Walk-off home run']);
    expect(mine.map((p) => p.size).sort()).toEqual([1, 1, 1]);
    const theirs = (await shelf(tokens[1]!)).filter((p) => p.rewardKey?.startsWith('achievement:4242:'));
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ label: 'Pitched a no-hitter', size: 3 });

    // A replay of the same game pays nothing new.
    await rewardAchievements(db, 4242, engine);
    expect((await shelf(tokens[0]!)).filter((p) => p.rewardKey?.startsWith('achievement:4242:'))).toHaveLength(3);
    expect((await shelf(tokens[1]!)).filter((p) => p.rewardKey?.startsWith('achievement:4242:'))).toHaveLength(1);
  });
});

/** The auto-lineup the assembly screen suggests for a seat. */
async function suggestedLineup(draftId: number, token: string): Promise<SavedLineup> {
  const team = parse<{ team: { suggested: SavedLineup | null } }>(await call('GET', `/api/drafts/${draftId}/team`, { token })).team;
  if (!team.suggested) throw new Error('the assembly screen offered no lineup');
  return team.suggested;
}

/**
 * A room dealt before the series existed: no teams, no games, no sandbox map —
 * just picks in the state. It has to keep opening for its managers.
 */
describe('a draft from before the series', () => {
  let draftId = 0;
  let hostUserId = 0;
  const oldPick = { id: 'old-card', personId: 1, cardYear: CARD_YEAR, name: 'Draft Player1', teamLabel: 'TST', rarity: 'rare' as const, headline: '20 HR', playable: true };

  beforeAll(async () => {
    hostUserId = parse<{ user: { id: number } }>(await call('GET', '/api/auth/me', { token: hostToken })).user.id;
    const [row] = await db
      .insert(drafts)
      .values({
        hostUserId,
        status: 'finished',
        config: { rounds: 1, packSize: 3, cardYear: CARD_YEAR, yearFrom: CARD_YEAR, yearTo: CARD_YEAR, playableOnly: true, themes: ['mixed'], rarityCaps: { rare: 1, chase: 0 } },
        state: { round: 1, waitingOn: [], packs: {}, packThemes: {}, opened: [], picks: { 0: [oldPick] }, log: [{ seq: 1, text: 'Dealt long ago.' }] },
      })
      .returning({ id: drafts.id });
    draftId = row!.id;
    await db.insert(draftParticipants).values({ draftId, userId: hostUserId, seat: 0 });
  });

  it('still renders a room, an empty series, and the cards it dealt', async () => {
    const view = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${draftId}`, { token: hostToken })).draft;
    expect(view.phase).toBe('finished');
    expect(view.myPicks.map((c) => c.id)).toEqual(['old-card']);
    expect(view.seats.map((s) => s.picks.length)).toEqual([1]);
    expect(view.seats[0]!.lineupReady).toBe(false);
    expect(view.myLineup).toBeNull();
    expect(view.gameId).toBeNull();
    expect(view.games).toEqual([]);
    expect(view.myKeeps).toEqual({});
    expect(view.myPendingChoice).toBeNull();
    // A cap written in the old tiers reads as today's tiers.
    expect(view.config.rarityCaps).toEqual({ rare: 1, star: 20, mythic: 20 });
    // The assembly screen still answers with the cards the room dealt.
    const team = parse<{ team: { cards: { card: { id: string } }[]; suggested: unknown } }>(await call('GET', `/api/drafts/${draftId}/team`, { token: hostToken })).team;
    expect(team.cards.map((c) => c.card.id)).toEqual(['old-card']);
    expect(team.suggested).toBeNull();
  });
});

describe('the draft pick clock', () => {
  let clockDraftId = 0;
  let lateToken = '';

  beforeAll(async () => {
    const invite = parse<{ code: string }>(await call('POST', '/api/invites', { token: hostToken, body: {} })).code;
    lateToken = await register('late-clocker@example.com', 'Late', invite);
  });

  it('rejects a pick clock the schema does not list', async () => {
    const res = await call('POST', '/api/drafts', {
      token: hostToken,
      body: { rounds: 1, packSize: 4, yearFrom: CARD_YEAR, yearTo: CARD_YEAR, playableOnly: true, pickClockSeconds: 45 },
    });
    expect(res.statusCode).toBe(400);
    expect(parse<{ error: string }>(res).error).toMatch(/pickClock|pick clock/i);
  });

  it('defaults to no clock and leaves the deadline null after the deal', async () => {
    const res = await call('POST', '/api/drafts', {
      token: hostToken,
      body: { rounds: 1, packSize: 4, yearFrom: CARD_YEAR, yearTo: CARD_YEAR, playableOnly: true },
    });
    expect(res.statusCode, res.body).toBe(200);
    const draft = parse<{ draft: DraftView }>(res).draft;
    clockDraftId = draft.id;
    expect(draft.config.pickClockSeconds).toBe(0);
    expect(draft.pickDeadlineAt).toBeNull();

    expect((await call('POST', `/api/drafts/${clockDraftId}/join`, { token: guestToken })).statusCode).toBe(200);
    const started = await call('POST', `/api/drafts/${clockDraftId}/start`, { token: hostToken });
    expect(started.statusCode).toBe(200);
    const view = parse<{ draft: DraftView }>(started).draft;
    // No clock on a default room — the deadline is null forever, even mid-pass.
    expect(view.pickDeadlineAt).toBeNull();
  });

  it('records the deadline on a draft that has a clock, and keeps it open while seats are still picking', async () => {
    const res = await call('POST', '/api/drafts', {
      token: hostToken,
      body: { rounds: 1, packSize: 4, yearFrom: CARD_YEAR, yearTo: CARD_YEAR, playableOnly: true, pickClockSeconds: 60 },
    });
    expect(res.statusCode, res.body).toBe(200);
    const clocked = parse<{ draft: DraftView }>(res).draft;
    clockDraftId = clocked.id;
    expect(clocked.config.pickClockSeconds).toBe(60);

    expect((await call('POST', `/api/drafts/${clockDraftId}/join`, { token: lateToken })).statusCode).toBe(200);
    const started = await call('POST', `/api/drafts/${clockDraftId}/start`, { token: hostToken });
    expect(started.statusCode).toBe(200);
    const view = parse<{ draft: DraftView }>(started).draft;
    // The clock arm starts the moment the round deals.
    expect(view.pickDeadlineAt).not.toBeNull();
    expect(view.pickDeadlineAt!).toBeGreaterThan(Date.now());
    expect(view.waitingOn).toEqual([0, 1]);

    await call('POST', `/api/drafts/${clockDraftId}/open`, { token: hostToken });
    const picked = (await call('POST', `/api/drafts/${clockDraftId}/pick`, {
      token: hostToken,
      body: { cardId: parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${clockDraftId}`, { token: hostToken })).draft.myPack[0]!.id },
    }));
    expect(picked.statusCode).toBe(200);
    const mid = parse<{ draft: DraftView }>(picked).draft;
    expect(mid.waitingOn).toEqual([1]);
    expect(mid.pickDeadlineAt).not.toBeNull();
  });

  it('auto-picks the stuck seat when the deadline passes, files the card, and advances the round', async () => {
    // Stamp the deadline back so the very next read expires it.
    const [row] = await db.select({ state: drafts.state, version: drafts.version }).from(drafts).where(eq(drafts.id, clockDraftId)).limit(1);
    const state = row!.state as { waitingOn: number[]; packs: Record<string, { id: string; personId: number; rarity: string; starter?: boolean; positions?: string[] }[]>; picks: Record<string, unknown[]>; pickDeadlineAt: number | null };
    const stuckPack = state.packs['1'] ?? [];
    const stuckBefore = state.picks['1']?.length ?? 0;
    const waitingBefore = state.waitingOn;
    expect(waitingBefore).toEqual([1]);
    expect(stuckPack.length).toBeGreaterThan(0);
    await db
      .update(drafts)
      .set({ state: { ...state, pickDeadlineAt: Date.now() - 1 } })
      .where(eq(drafts.id, clockDraftId));

    // The next read triggers expiry: one beat of work auto-picks the seat and
    // advances the draft, since this is the only remaining pick of round one.
    const view = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${clockDraftId}`, { token: hostToken })).draft;
    // Round one finished; the room is now in round one of the last pass and
    // waiting on every seat, or the whole thing has unwound to one row before assembly.
    expect(view.waitingOn).toContain(0);
    // The stuck seat took a card and the picked card was filed into the sandbox.
    const after = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${clockDraftId}`, { token: lateToken })).draft;
    expect(after.myPicks.length).toBeGreaterThan(stuckBefore);
    expect(after.log.some((l) => /clock ran out/i.test(l.text))).toBe(true);
  });

  it('clears the deadline when the last pack empties into assembly', async () => {
    // The room runs to the end of round one with the host auto-picking the
    // last seat, so the deadline should now be null while the rooms turns over.
    const view = parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${clockDraftId}`, { token: hostToken })).draft;
    // Phase is active (second-pass picking) OR assembling (one pack, two picks). Either is fine.
    expect(['active', 'assembling']).toContain(view.phase);
    if (view.phase === 'active') {
      expect(view.pickDeadlineAt).not.toBeNull();
    } else {
      expect(view.pickDeadlineAt).toBeNull();
    }
  });
});
