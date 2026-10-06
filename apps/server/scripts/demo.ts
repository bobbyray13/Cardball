/**
 * A ready-to-play demo server on a throwaway database.
 *
 * `pnpm --filter @cardball/server demo` drops and rebuilds a `cardball_demo`
 * database, seeds it with a little league of fictional players, signs in a
 * demo manager, files a full binder of cards, builds two teams, and opens a
 * bot game — then serves it on the normal dev port. Point the web client at
 * it (`pnpm dev:web` from the root) and log in as the printed account to see
 * the whole game on the mat without importing any real stats.
 *
 * The demo database is throwaway: re-running drops it, and shutting the server
 * down (Ctrl-C) drops it again.
 */
import postgres from 'postgres';
import { createDb, people, runMigrations, seasons } from '@cardball/db';
import type { Position } from '@cardball/shared';
import { buildApp } from '../src/app.js';
import type { Ctx } from '../src/context.js';
import { env } from '../src/env.js';
import { attachRealtime } from '../src/realtime.js';
import { refreshHouseRules } from '../src/settingsService.js';

const DEMO_URL = process.env.DEMO_DATABASE_URL ?? 'postgres://cardball:cardball@localhost:5433/cardball_demo';
const ADMIN_URL = DEMO_URL.replace(/\/[^/]+$/, '/postgres');
const DB_NAME = new URL(DEMO_URL).pathname.slice(1);
const PORT = env.port;

const DEMO_EMAIL = 'demo@cardball.test';
const DEMO_PASSWORD = 'playball!';
const CARD_YEAR = 2006;
const YEARS = [2000, 2001, 2002, 2003, 2004, 2005];

/** Batting stats shared by every season on a demo card. */
interface DemoBat {
  games: number;
  ab: number;
  h: number;
  avg: number | null;
  doubles: number;
  triples: number;
  homeRuns: number;
  rbi: number;
  sb: number;
  pa: number;
}

interface DemoPlayer {
  bbrefId: string;
  first: string;
  last: string;
  /** where he can field, with a fielding rating per spot */
  positions: [Position, number][];
  bat: DemoBat;
  /** a pitcher's season line, flat as the seasons table keeps it */
  pitch?: { games: number; ipOuts: number; era: number };
}

/** A league of archetypes: the burner, the slugger, the glove, the workhorse. */
const LEAGUE: DemoPlayer[] = [
  {
    bbrefId: 'sterlca01', first: 'Casey', last: 'Sterling', positions: [['CF', 2], ['LF', 1], ['RF', 1]],
    bat: { games: 155, ab: 600, pa: 660, h: 175, avg: 0.292, doubles: 32, triples: 12, homeRuns: 10, rbi: 62, sb: 68 },
  },
  {
    bbrefId: 'kannore01', first: 'Rex', last: 'Kannon', positions: [['1B', 1], ['LF', 0]],
    bat: { games: 158, ab: 590, pa: 645, h: 158, avg: 0.268, doubles: 30, triples: 1, homeRuns: 48, rbi: 132, sb: 2 },
  },
  {
    bbrefId: 'vespesi01', first: 'Sid', last: 'Vesper', positions: [['SS', 3], ['2B', 2], ['3B', 1]],
    bat: { games: 152, ab: 540, pa: 590, h: 146, avg: 0.27, doubles: 28, triples: 6, homeRuns: 8, rbi: 55, sb: 24 },
  },
  {
    bbrefId: 'finchma01', first: 'Marlowe', last: 'Finch', positions: [['C', 2], ['1B', 0]],
    bat: { games: 148, ab: 520, pa: 570, h: 164, avg: 0.315, doubles: 34, triples: 2, homeRuns: 15, rbi: 84, sb: 4 },
  },
  {
    bbrefId: 'ellswdu01', first: 'Duke', last: 'Ellsworth', positions: [['3B', 2], ['1B', 1]],
    bat: { games: 156, ab: 575, pa: 620, h: 152, avg: 0.264, doubles: 33, triples: 2, homeRuns: 32, rbi: 105, sb: 6 },
  },
  {
    bbrefId: 'nunziar01', first: 'Artie', last: 'Nunzio', positions: [['2B', 2], ['SS', 1], ['RF', 0]],
    bat: { games: 150, ab: 560, pa: 615, h: 157, avg: 0.28, doubles: 26, triples: 8, homeRuns: 6, rbi: 48, sb: 34 },
  },
  {
    bbrefId: 'wildejo01', first: 'Jonah', last: 'Wilde', positions: [['RF', 2], ['CF', 1]],
    bat: { games: 157, ab: 585, pa: 640, h: 165, avg: 0.282, doubles: 42, triples: 5, homeRuns: 22, rbi: 92, sb: 10 },
  },
  {
    bbrefId: 'merrily01', first: 'Lyle', last: 'Merrick', positions: [['LF', 2], ['RF', 1], ['1B', 0]],
    bat: { games: 145, ab: 500, pa: 550, h: 138, avg: 0.276, doubles: 25, triples: 3, homeRuns: 18, rbi: 76, sb: 8 },
  },
  {
    bbrefId: 'dunnho01', first: 'Hollis', last: 'Dunn', positions: [['LF', 1], ['RF', 1], ['1B', 0]],
    bat: { games: 142, ab: 510, pa: 560, h: 156, avg: 0.306, doubles: 31, triples: 4, homeRuns: 25, rbi: 98, sb: 5 },
  },
  {
    bbrefId: 'callape01', first: 'Petey', last: 'Calloway', positions: [['C', 1], ['1B', 1], ['LF', 0]],
    bat: { games: 110, ab: 320, pa: 350, h: 84, avg: 0.263, doubles: 16, triples: 2, homeRuns: 12, rbi: 45, sb: 3 },
  },
  {
    bbrefId: 'torresgi01', first: 'Gil', last: 'Torres', positions: [['C', 3], ['3B', 0]],
    bat: { games: 95, ab: 250, pa: 280, h: 62, avg: 0.248, doubles: 12, triples: 1, homeRuns: 6, rbi: 32, sb: 2 },
  },
  // the staff: two horses, three relievers
  {
    bbrefId: 'vanceco01', first: 'Cobb', last: 'Vance', positions: [['P', 2]],
    bat: { games: 34, ab: 0, pa: 0, h: 0, avg: null, doubles: 0, triples: 0, homeRuns: 0, rbi: 0, sb: 0 },
    pitch: { games: 34, ipOuts: 580, era: 2.72 },
  },
  {
    bbrefId: 'delacso01', first: 'Sonny', last: 'Delacroix', positions: [['P', 1]],
    bat: { games: 32, ab: 0, pa: 0, h: 0, avg: null, doubles: 0, triples: 0, homeRuns: 0, rbi: 0, sb: 0 },
    pitch: { games: 32, ipOuts: 500, era: 3.14 },
  },
  {
    bbrefId: 'okafor01', first: 'Fitz', last: 'Okafor', positions: [['P', 1]],
    bat: { games: 55, ab: 0, pa: 0, h: 0, avg: null, doubles: 0, triples: 0, homeRuns: 0, rbi: 0, sb: 0 },
    pitch: { games: 55, ipOuts: 150, era: 3.41 },
  },
  {
    bbrefId: 'saltre01', first: 'Remy', last: 'Salt', positions: [['P', 0]],
    bat: { games: 60, ab: 0, pa: 0, h: 0, avg: null, doubles: 0, triples: 0, homeRuns: 0, rbi: 0, sb: 0 },
    pitch: { games: 60, ipOuts: 140, era: 3.88 },
  },
  {
    bbrefId: 'churchbo01', first: 'Boone', last: 'Church', positions: [['P', 0]],
    bat: { games: 48, ab: 0, pa: 0, h: 0, avg: null, doubles: 0, triples: 0, homeRuns: 0, rbi: 0, sb: 0 },
    pitch: { games: 48, ipOuts: 120, era: 4.21 },
  },
];

const log = (message: string) => console.log(message);

/** Drop and rebuild the throwaway demo database. */
async function recreateDatabase(): Promise<void> {
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    await admin.unsafe(`drop database if exists "${DB_NAME}"`);
    await admin.unsafe(`create database "${DB_NAME}"`);
  } finally {
    await admin.end();
  }
  await runMigrations(DEMO_URL);
}

/** One season row per year on the back of every demo card. */
async function seedLeague(db: Ctx['db']): Promise<void> {
  for (const player of LEAGUE) {
    const [row] = await db
      .insert(people)
      .values({
        bbrefId: player.bbrefId,
        nameFirst: player.first,
        nameLast: player.last,
        bats: 'R',
        throws: 'R',
        debutYear: YEARS[0]!,
        finalYear: YEARS[YEARS.length - 1]!,
        // A starter is a pitcher who ever threw 100+ innings in a season.
        isStarter: (player.pitch?.ipOuts ?? 0) >= 300,
      })
      .returning({ id: people.id });
    await db.insert(seasons).values(
      YEARS.map((year) => ({
        personId: row!.id,
        year,
        teamLabel: 'Demo League',
        ...player.bat,
        primaryPosition: player.positions[0]![0],
        positionsPlayed: player.positions.map(([position, rating]) => ({ position, games: 120, rating })),
        ...(player.pitch ? { pitchGames: player.pitch.games, pitchIpOuts: player.pitch.ipOuts, pitchEra: player.pitch.era } : {}),
      })),
    );
  }
  log(`Seeded ${LEAGUE.length} demo players, ${YEARS.length} seasons on every card.`);
}

/** Call the running API with the demo manager's session. */
let sessionCookie = '';
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  for (const cookie of cookies) {
    const [pair] = cookie.split(';');
    if (pair?.includes('=')) sessionCookie = pair;
  }
  return (await res.json().catch(() => ({}))) as T;
}

/** Sign the demo manager in, file every card, and open the bot game. */
async function openTheGates(): Promise<number> {
  await call('POST', '/api/auth/register', {
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    displayName: 'Demo Manager',
  });

  const personIds: number[] = [];
  for (const player of LEAGUE) {
    const { people: found } = await call<{ people: { id: number }[] }>(
      'GET',
      `/api/people/search?q=${encodeURIComponent(player.last)}&limit=1`,
    );
    const personId = found[0]?.id;
    if (!personId) throw new Error(`Could not find ${player.last} after seeding`);
    personIds.push(personId);
    await call('POST', '/api/collection', { personId, cardYear: CARD_YEAR, source: 'database' });
  }

  const teamIds: number[] = [];
  for (const name of ['Duke Street Nine', 'Harbor City Herons']) {
    const { team } = await call<{ team: { id: number } }>('POST', '/api/teams', { name });
    const cards = await call<{ cards: { id: number }[] }>('GET', '/api/collection');
    await call('PUT', `/api/teams/${team.id}/roster`, { userCardIds: cards.cards.map((c) => c.id) });
    await call('POST', `/api/teams/${team.id}/auto-lineup`);
    teamIds.push(team.id);
  }

  const { game } = await call<{ game: { id: number } }>('POST', '/api/games', {
    mode: 'bot',
    regulationInnings: 9,
    teamId: teamIds[0]!,
    opponentTeamId: teamIds[1]!,
  });
  return game.id;
}

async function main(): Promise<void> {
  log(`Rebuilding the throwaway demo database "${DB_NAME}"…`);
  await recreateDatabase();

  const { db, sql } = createDb(DEMO_URL);
  const ctx: Ctx = { db, io: null };

  await refreshHouseRules(ctx);
  await seedLeague(db);

  const app = await buildApp(ctx, { logger: false });
  ctx.io = attachRealtime(app.server, ctx);
  await app.listen({ port: PORT, host: '127.0.0.1' });

  const gameId = await openTheGates();

  log('');
  log('Demo ready.');
  log(`  Log in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  log(`  Your game: http://localhost:5173/games/${gameId} (press Play ball, then throw pitches)`);
  log('  Ctrl-C stops the server and drops the demo database.');
  log('');

  const shutdown = async () => {
    ctx.io?.close();
    await app.close();
    await sql.end();
    const admin = postgres(ADMIN_URL, { max: 1 });
    try {
      await admin.unsafe(`drop database if exists "${DB_NAME}"`);
    } finally {
      await admin.end();
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
