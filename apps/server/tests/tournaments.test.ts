/**
 * Tournament tests against a real Postgres.
 *
 * Three managers draft once, the draft finishes, and the tournament builds each
 * manager a team out of exactly their picks, schedules a round robin, plays the
 * matches out with the bot policy, and crowns a champion — all through the API.
 */
import postgres from 'postgres';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, drafts, people, runMigrations, seasons } from '@cardball/db';
import type { Db } from '@cardball/db';
import type { DraftView, TeamView, TournamentView } from '@cardball/shared';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE } from '../src/auth.js';
import type { Ctx } from '../src/context.js';
import { env } from '../src/env.js';

const BASE_URL = env.databaseUrl;
const DB_NAME = `${new URL(BASE_URL).pathname.slice(1)}_tournaments`;
const TEST_URL = BASE_URL.replace(/\/[^/]+$/, `/${DB_NAME}`);
const ADMIN_URL = TEST_URL.replace(/\/[^/]+$/, '/postgres');
const CARD_YEAR = 2004;
const FIELD: ('C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF')[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
/** The stat window a card built on 2004 draws from. */
const WINDOW = [1998, 1999, 2000, 2001, 2002, 2003];

let app: Awaited<ReturnType<typeof buildApp>>;
let sql: Db['sql'];
let db: Db['db'];
let tokens: string[] = [];

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

/** A field-anywhere hitter, so any eight drafted hitters can fill a field. */
async function seedHitter(n: number): Promise<void> {
  const [person] = await db
    .insert(people)
    .values({
      bbrefId: `thit${String(n).padStart(2, '0')}`,
      nameFirst: 'Taylor',
      nameLast: `Hitter${n}`,
      bats: 'R',
      throws: 'R',
      debutYear: 1997,
      finalYear: 2003,
    })
    .returning({ id: people.id });
  await db.insert(seasons).values(
    WINDOW.map((year) => ({
      personId: person!.id,
      year,
      teamLabel: 'TST',
      games: 150,
      ab: 500,
      h: 150,
      avg: 0.3,
      doubles: 25,
      triples: 3,
      homeRuns: 15 + (n % 10),
      rbi: 80,
      sb: 8,
      pa: 550,
      primaryPosition: 'RF',
      positionsPlayed: FIELD.map((position) => ({ position, games: 90, rating: 1 })),
    })),
  );
}

/** A workhorse starter, so a drafted roster has someone to take the mound. */
async function seedStarter(n: number): Promise<void> {
  const [person] = await db
    .insert(people)
    .values({
      bbrefId: `tace${String(n).padStart(2, '0')}`,
      nameFirst: 'Sam',
      nameLast: `Starter${n}`,
      bats: 'R',
      throws: 'R',
      debutYear: 1997,
      finalYear: 2003,
      isStarter: true,
    })
    .returning({ id: people.id });
  await db.insert(seasons).values(
    WINDOW.map((year) => ({
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
      pitchEra: 3.2,
      pitchBf: 900,
      primaryPosition: 'P',
      positionsPlayed: [{ position: 'P' as const, games: 32, rating: 1 }],
    })),
  );
}

const tournamentConfig = {
  name: 'The Test Classic',
  format: 'round-robin' as const,
  seats: 3,
  regulationInnings: 3,
  autoSimulate: true,
  draft: { rounds: 2, packSize: 8, yearFrom: CARD_YEAR, yearTo: CARD_YEAR, themes: [], rarityCaps: null },
};

/** One manager's view of the draft room. */
const draftView = async (draftId: number, token: string): Promise<DraftView> =>
  parse<{ draft: DraftView }>(await call('GET', `/api/drafts/${draftId}`, { token })).draft;

/**
 * Play out every seat's turn until the packs are empty. Each manager grabs a
 * starting pitcher as soon as one reaches them, so the rosters can field nine.
 */
async function drainDraft(draftId: number, tokens: string[], noPitchers: string[] = []): Promise<DraftView> {
  const isPitcher = (headline: string) => /ERA/.test(headline) && !/no pitching/.test(headline);
  for (let guard = 0; guard < 1000; guard++) {
    let acted = false;
    for (const token of tokens) {
      const view = await draftView(draftId, token);
      if (view.phase === 'finished') return view;
      if (view.myPack.length === 0) continue;
      if (!view.myPackOpened) {
        expect((await call('POST', `/api/drafts/${draftId}/open`, { token })).statusCode).toBe(200);
        acted = true;
        continue;
      }
      if (view.iHavePicked) continue;
      // Draft like a manager with a plan: one starter, no duplicate players,
      // then nothing but bats — enough distinct cards to field nine.
      const owned = new Set(view.myPicks.map((c) => c.personId));
      const fresh = (c: { personId: number; headline: string }) => !owned.has(c.personId);
      const needsPitcher = !noPitchers.includes(token) && !view.myPicks.some((c) => isPitcher(c.headline));
      const pick =
        (needsPitcher ? view.myPack.find((c) => isPitcher(c.headline) && fresh(c)) : undefined) ??
        view.myPack.find((c) => !isPitcher(c.headline) && fresh(c)) ??
        view.myPack.find((c) => !isPitcher(c.headline)) ??
        view.myPack[0]!;
      const res = await call('POST', `/api/drafts/${draftId}/pick`, { token, body: { cardId: pick.id } });
      expect(res.statusCode, res.body).toBe(200);
      acted = true;
    }
    if (!acted) throw new Error('the draft stalled with packs on the table');
  }
  throw new Error('the draft never finished');
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

  // The pool the packs deal from: mostly hitters who can field anywhere, a
  // realistic sprinkle of starters. Drafts only work if the pool is shaped
  // like a league — a starter-heavy pool leaves nobody who can bat.
  for (let i = 1; i <= 80; i++) await seedHitter(i);
  for (let i = 1; i <= 12; i++) await seedStarter(i);

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

describe('tournaments', () => {
  let tournamentId = 0;

  beforeAll(async () => {
    const host = await register('commissioner@example.com', 'Commissioner');
    // Invites are single-use, so every manager gets their own.
    const inviteFor = async () => parse<{ code: string }>(await call('POST', '/api/invites', { token: host, body: {} })).code;
    tokens = [host, await register('rival@example.com', 'Rival', await inviteFor()), await register('fan@example.com', 'Fan', await inviteFor())];
  });

  it('opens a tournament with the host in seat one, and refuses nonsense settings', async () => {
    const res = await call('POST', '/api/tournaments', { token: tokens[0], body: tournamentConfig });
    expect(res.statusCode, res.body).toBe(200);
    const tournament = parse<{ tournament: TournamentView }>(res).tournament;
    tournamentId = tournament.id;
    expect(tournament.status).toBe('lobby');
    expect(tournament.config.seats).toBe(3);
    expect(tournament.seats.map((s) => s.name)).toEqual(['Commissioner', 'Open seat', 'Open seat']);
    expect(tournament.seats[0]!.isHost).toBe(true);

    // Too few picks to field a team, and an era nobody played in.
    const tooThin = await call('POST', '/api/tournaments', {
      token: tokens[0],
      body: { ...tournamentConfig, name: 'Too thin', draft: { ...tournamentConfig.draft, rounds: 1, packSize: 6 } },
    });
    expect(tooThin.statusCode).toBe(400);
    expect(parse<{ error: string }>(tooThin).error).toMatch(/at least 12 cards each/i);

    const emptyEra = await call('POST', '/api/tournaments', {
      token: tokens[0],
      body: { ...tournamentConfig, name: 'Empty era', draft: { ...tournamentConfig.draft, yearFrom: 1873, yearTo: 1873 } },
    });
    expect(emptyEra.statusCode).toBe(400);
  });

  it('seats managers in order and refuses a fourth at a three-seat table', async () => {
    expect((await call('POST', `/api/tournaments/${tournamentId}/join`, { token: tokens[1] })).statusCode).toBe(200);
    expect((await call('POST', `/api/tournaments/${tournamentId}/join`, { token: tokens[2] })).statusCode).toBe(200);

    const fourth = await register('late@example.com', 'Latecomer', parse<{ code: string }>(await call('POST', '/api/invites', { token: tokens[0], body: {} })).code);
    const refused = await call('POST', `/api/tournaments/${tournamentId}/join`, { token: fourth });
    expect(refused.statusCode).toBe(400);
    expect(parse<{ error: string }>(refused).error).toMatch(/all 3 seats are taken/i);

    // Only the host deals.
    expect((await call('POST', `/api/tournaments/${tournamentId}/start`, { token: tokens[1] })).statusCode).toBe(403);
  });

  it('deals the packs when the host starts, and hides the draft room from the public list', async () => {
    const res = await call('POST', `/api/tournaments/${tournamentId}/start`, { token: tokens[0] });
    expect(res.statusCode, res.body).toBe(200);
    const tournament = parse<{ tournament: TournamentView }>(res).tournament;
    expect(tournament.status).toBe('drafting');
    expect(tournament.draftId).not.toBeNull();
    expect(tournament.matches.map((m) => m.id).sort()).toEqual(['rr-0-1', 'rr-0-2', 'rr-1-2']);
    expect(tournament.matches.every((m) => m.gameId === null)).toBe(true);
    expect(tournament.log.at(-1)!.text).toMatch(/packs on the table/i);

    // The tournament owns its draft: the room stays off the public draft list.
    const drafts = parse<{ drafts: { id: number }[] }>(await call('GET', '/api/drafts', { token: tokens[1] })).drafts;
    expect(drafts.some((d) => d.id === tournament.draftId)).toBe(false);

    // Seats are locked once the dealing starts.
    expect((await call('POST', `/api/tournaments/${tournamentId}/join`, { token: tokens[0] })).statusCode).toBe(400);
  });

  it('drafts to the last card, then builds drafted-only rosters, plays out the schedule, and crowns a champion', async () => {
    const tournament = parse<{ tournament: TournamentView }>(await call('GET', `/api/tournaments/${tournamentId}`, { token: tokens[0] })).tournament;
    expect(tournament.status).toBe('drafting');
    const finished = await drainDraft(tournament.draftId!, tokens);
    expect(finished.phase).toBe('finished');
    // Sixteen picked cards, plus whatever field insurance topped the seat up
    // with: a seat that drafted no starter, or too few distinct bats, is
    // dealt what it lacks as the last pack empties.
    expect(finished.myPicks.length).toBeGreaterThanOrEqual(16);

    // Reading the tournament catches up: teams, games, results, champion.
    const played = parse<{ tournament: TournamentView }>(await call('GET', `/api/tournaments/${tournamentId}`, { token: tokens[1] })).tournament;
    expect(played.status).toBe('finished');
    expect(played.championSeat).not.toBeNull();

    // Every seat has a team built from exactly its picks. Teams are private to
    // their owner, so each manager reads their own with their own token.
    const tokenByUser = new Map<number, string>();
    for (const token of tokens) {
      const me = parse<{ user: { id: number } }>(await call('GET', '/api/auth/me', { token })).user;
      tokenByUser.set(me.id, token);
    }
    for (const seat of played.seats) {
      expect(seat.teamId).not.toBeNull();
      expect(seat.teamName).toMatch(/ · The Test Classic$/);
      const ownToken = tokenByUser.get(seat.userId)!;
      const team = parse<{ team: TeamView }>(await call('GET', `/api/teams/${seat.teamId}`, { token: ownToken })).team;
      // Sixteen picks, minus any duplicated player: enough to field nine.
      expect(team.roster.length).toBeGreaterThanOrEqual(10);
      expect(team.lineup).not.toBeNull();
    }

    // The round robin played out: three finals, one champion's record.
    expect(played.matches).toHaveLength(3);
    expect(played.matches.every((m) => m.winnerSeat !== null && m.gameId !== null)).toBe(true);
    expect(Object.keys(played.scores)).toHaveLength(3);
    const wins = played.seats.map((s) => s.wins);
    expect(wins.reduce((a, b) => a + b, 0)).toBe(3);
    expect(played.seats.reduce((a, s) => a + s.losses, 0)).toBe(3);

    // Each match is a real, finished game whose era is the tournament's, and
    // every seated manager can watch it, including the one not playing.
    for (const match of played.matches) {
      for (const token of tokens) {
        const res = await call('GET', `/api/games/${match.gameId}`, { token });
        expect(res.statusCode, res.body).toBe(200);
        const game = parse<{ game: { status: string; match: { yearFrom: number; yearTo: number } } }>(res).game;
        expect(game.status).toBe('finished');
        expect(game.match).toMatchObject({ yearFrom: CARD_YEAR, yearTo: CARD_YEAR });
      }
    }

    // A watching manager can talk in the game, and so can anyone else in the league.
    const sittingOut = played.matches.find((m) => m.homeSeat !== 0 && m.awaySeat !== 0)!;
    const chat = await call('POST', `/api/games/${sittingOut.gameId}/chat`, { token: tokens[0], body: { body: 'Good game!' } });
    expect(chat.statusCode, chat.body).toBe(200);
    const outsider = await register('outsider@example.com', 'Outsider', parse<{ code: string }>(await call('POST', '/api/invites', { token: tokens[0], body: {} })).code);
    expect((await call('GET', `/api/games/${sittingOut.gameId}`, { token: outsider })).statusCode).toBe(200);

    // Simulated matches still write each drafted card's line into its history.
    const myTeamId = parse<{ teams: { id: number }[] }>(await call('GET', '/api/teams', { token: tokens[0] })).teams[0]!.id;
    const myRoster = parse<{ team: { roster: { id: number }[] } }>(await call('GET', `/api/teams/${myTeamId}`, { token: tokens[0] })).team.roster;
    const careers = await Promise.all(
      myRoster.map(async (entry) => parse<{ career: { games: number } }>(await call('GET', `/api/collection/${entry.id}/career`, { token: tokens[0] })).career),
    );
    expect(Math.max(...careers.map((c) => c.games))).toBeGreaterThan(0);

    expect(played.log.at(-1)!.text).toMatch(/wins the tournament/i);

    // A finished tournament is done: no joins, no restarts, nothing to simulate.
    expect((await call('POST', `/api/tournaments/${tournamentId}/join`, { token: tokens[0] })).statusCode).toBe(400);
    expect((await call('POST', `/api/tournaments/${tournamentId}/start`, { token: tokens[0] })).statusCode).toBe(400);
    expect((await call('POST', `/api/tournaments/${tournamentId}/simulate`, { token: tokens[0] })).statusCode).toBe(400);
  });

  it('marks tournament teams and games as out-of-position friendly, and warns drafters what they lack', async () => {
    const t = parse<{ tournament: TournamentView }>(await call('GET', `/api/tournaments/${tournamentId}`, { token: tokens[0] })).tournament;
    const team = parse<{ team: TeamView }>(await call('GET', `/api/teams/${t.seats[0]!.teamId}`, { token: tokens[0] })).team;
    expect(team.outOfPosition).toBe(true);
    const game = parse<{ game: { match: { outOfPosition?: boolean } } }>(await call('GET', `/api/games/${t.matches[0]!.gameId}`, { token: tokens[0] })).game;
    expect(game.match.outOfPosition).toBe(true);

    // The draft room knows whose roster it is building, and what each card covers.
    const draft = await draftView(t.draftId!, tokens[0]!);
    expect(draft.tournamentId).toBe(tournamentId);
    expect(draft.myPicks.every((c) => Array.isArray(c.positions) && typeof c.starter === 'boolean')).toBe(true);

    // An ordinary team is still held to its cards.
    const plain = parse<{ team: TeamView }>(await call('POST', '/api/teams', { token: tokens[0], body: { name: 'Plain Team' } })).team;
    expect(plain.outOfPosition).toBe(false);
  });

  it('forfeits a manager who drafted no starter, and the bracket still reaches its final', async () => {
    const res = await call('POST', '/api/tournaments', {
      token: tokens[0],
      body: { ...tournamentConfig, name: 'The Forfeit Cup', format: 'semis' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const id = parse<{ tournament: TournamentView }>(res).tournament.id;
    for (const token of tokens.slice(1)) expect((await call('POST', `/api/tournaments/${id}/join`, { token })).statusCode).toBe(200);
    const started = parse<{ tournament: TournamentView }>(await call('POST', `/api/tournaments/${id}/start`, { token: tokens[0] })).tournament;

    // Seat three (the Fan) never takes a pitcher. The last passes can still
    // force one on him, so take any starter back out of his picks before the
    // tournament reads the finished draft.
    await drainDraft(started.draftId!, tokens, [tokens[2]!]);
    const [draftRow] = await db.select().from(drafts).where(eq(drafts.id, started.draftId!));
    const draftState = draftRow!.state as { picks: Record<string, { starter?: boolean }[]> };
    draftState.picks['2'] = draftState.picks['2']!.filter((c) => !c.starter);
    await db.update(drafts).set({ state: draftState }).where(eq(drafts.id, started.draftId!));

    const done = parse<{ tournament: TournamentView }>(await call('GET', `/api/tournaments/${id}`, { token: tokens[0] })).tournament;

    expect(done.status).toBe('finished');
    const semi = done.matches.find((m) => m.id === 'semi-1')!;
    expect(semi).toMatchObject({ forfeit: true, winnerSeat: 1, loserSeat: 2, gameId: null });
    const final = done.matches.find((m) => m.id === 'final')!;
    expect(final.gameId).not.toBeNull();
    expect([0, 1]).toContain(final.winnerSeat);
    expect(done.championSeat).toBe(final.winnerSeat);
    expect(done.seats[2]!.teamId).not.toBeNull();
    expect(done.seats[2]!.losses).toBe(1);
    expect(done.log.some((l) => /Fan can't field a team .*forfeits/.test(l.text))).toBe(true);
    expect(done.log.some((l) => /Rival wins by forfeit/.test(l.text))).toBe(true);
  });

  it('runs a rematch with the same teams and a fresh bracket, without a second draft', async () => {
    const before = parse<{ tournament: TournamentView }>(await call('GET', `/api/tournaments/${tournamentId}`, { token: tokens[0] })).tournament;
    const teams = before.seats.map((s) => s.teamId);

    expect((await call('POST', `/api/tournaments/${tournamentId}/rematch`, { token: tokens[1] })).statusCode).toBe(403);
    const res = await call('POST', `/api/tournaments/${tournamentId}/rematch`, { token: tokens[0] });
    expect(res.statusCode, res.body).toBe(200);
    const rematch = parse<{ tournament: TournamentView }>(res).tournament;
    expect(rematch.id).not.toBe(tournamentId);
    expect(rematch.name).toBe(`${before.name} (rematch)`);
    expect(rematch.status).toBe('lobby');
    expect(rematch.matches).toEqual([]);
    expect(rematch.championSeat).toBeNull();
    expect(rematch.log.at(-1)!.text).toMatch(/rematch of/i);
    // The same managers in the same seats, with the same teams.
    expect(rematch.seats.map((s) => s.name)).toEqual(before.seats.map((s) => s.name));
    expect(rematch.seats.map((s) => s.teamId)).toEqual(teams);

    // Starting it skips the draft entirely: the bracket is scheduled at once
    // and the teams on the field are the first run's.
    const started = await call('POST', `/api/tournaments/${rematch.id}/start`, { token: tokens[0] });
    expect(started.statusCode, started.body).toBe(200);
    expect(parse<{ tournament: TournamentView }>(started).tournament.matches).toHaveLength(3);

    const played = parse<{ tournament: TournamentView }>(await call('GET', `/api/tournaments/${rematch.id}`, { token: tokens[1] })).tournament;
    expect(played.status).toBe('finished');
    expect(played.championSeat).not.toBeNull();
    expect(played.matches.every((m) => m.gameId !== null && m.winnerSeat !== null)).toBe(true);
    expect(played.seats.map((s) => s.teamId)).toEqual(teams);
    // Its games belong to the rematch, and it owns no draft room of its own.
    expect(played.draftId).toBeNull();
  });

  it('closes on the host and takes the draft room with it', async () => {
    const before = parse<{ tournament: TournamentView }>(await call('GET', `/api/tournaments/${tournamentId}`, { token: tokens[0] })).tournament;
    const draftId = before.draftId!;

    expect((await call('DELETE', `/api/tournaments/${tournamentId}`, { token: tokens[1] })).statusCode).toBe(403);
    expect((await call('DELETE', `/api/tournaments/${tournamentId}`, { token: tokens[0] })).statusCode).toBe(200);
    expect((await call('GET', `/api/tournaments/${tournamentId}`, { token: tokens[0] })).statusCode).toBe(404);
    expect((await call('GET', `/api/drafts/${draftId}`, { token: tokens[0] })).statusCode).toBe(404);
  });
});
