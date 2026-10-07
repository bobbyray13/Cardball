/**
 * Historic team collection challenges — the generator.
 *
 * One iconic season from every active franchise, pre-built: the starting
 * lineup (plus a DH where the era had one) and the pitching staff, read
 * straight out of the cached Lahman CSVs. The output is committed at
 * `packages/shared/src/historicTeams.ts`, so the app itself never needs the
 * CSVs at runtime and the catalog is reviewable in code review.
 *
 *   pnpm --filter @cardball/import-stats challenges [-- --check]
 *
 * `--check` re-runs the generator and fails if the committed file drifted,
 * so CI keeps the catalog honest against the current data.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cell, num, optionalText, parseCsvTable, requireColumns } from './csv.js';
import type { CsvTable } from './csv.js';
import { loadCsvFiles } from './download.js';
import type { CsvFileMap } from './download.js';

/**
 * The picks: one historic team per currently active franchise. `teamId` is the
 * Lahman franchise code for that season (the Brooklyn Dodgers are BRO, the New
 * York Giants NY1), `dh` says whether that league-year had the designated
 * hitter, and the tagline is what the collection screen sells it with.
 */
interface Pick {
  franchise: string;
  teamId: string;
  year: number;
  name: string;
  tagline: string;
  dh: boolean;
}

const PICKS: readonly Pick[] = [
  // ---- American League East ----
  { franchise: 'Baltimore Orioles', teamId: 'BAL', year: 1970, name: '1970 Baltimore Orioles', tagline: 'Brooks Robinson plays October on a different planet', dh: false },
  { franchise: 'Boston Red Sox', teamId: 'BOS', year: 1967, name: '1967 Boston Red Sox', tagline: 'The Impossible Dream — Yaz carries the card to the pennant', dh: false },
  { franchise: 'New York Yankees', teamId: 'NYA', year: 1961, name: '1961 New York Yankees', tagline: 'The M&M boys chase the Babe, 60 deep', dh: false },
  { franchise: 'Tampa Bay Rays', teamId: 'TBA', year: 2008, name: '2008 Tampa Bay Rays', tagline: '9 = 8, and a worst-to-first pennant', dh: true },
  { franchise: 'Toronto Blue Jays', teamId: 'TOR', year: 1993, name: '1993 Toronto Blue Jays', tagline: 'Back-to-back champions, and Joe Carter still touching ’em all', dh: true },
  // ---- American League Central ----
  { franchise: 'Chicago White Sox', teamId: 'CHA', year: 1959, name: '1959 Chicago White Sox', tagline: 'The Go-Go Sox — hit it on the ground and run', dh: false },
  { franchise: 'Cleveland Guardians', teamId: 'CLE', year: 1954, name: '1954 Cleveland Indians', tagline: '111 wins, and the best rotation money never had to buy', dh: false },
  { franchise: 'Detroit Tigers', teamId: 'DET', year: 1984, name: '1984 Detroit Tigers', tagline: 'Bless You Boys — 35–5 out of the gate', dh: true },
  { franchise: 'Kansas City Royals', teamId: 'KCA', year: 1985, name: '1985 Kansas City Royals', tagline: 'The I-70 Series comes home to Kansas City', dh: true },
  { franchise: 'Minnesota Twins', teamId: 'MIN', year: 1991, name: '1991 Minnesota Twins', tagline: 'Worst to first, and the greatest Game 7 ever pitched', dh: true },
  // ---- American League West ----
  { franchise: 'Houston Astros', teamId: 'HOU', year: 1998, name: '1998 Houston Astros', tagline: 'The Killer B’s, before the Astros ever left the National League', dh: false },
  { franchise: 'Los Angeles Angels', teamId: 'ANA', year: 2002, name: '2002 Anaheim Angels', tagline: 'The Rally Monkey drags a wildcard to the ring', dh: true },
  { franchise: 'Oakland Athletics', teamId: 'OAK', year: 1989, name: '1989 Oakland Athletics', tagline: 'The Bash Brothers sweep the Bay Bridge Series', dh: true },
  { franchise: 'Seattle Mariners', teamId: 'SEA', year: 1995, name: '1995 Seattle Mariners', tagline: 'Refuse to lose — the Kingdome will never be louder', dh: true },
  { franchise: 'Texas Rangers', teamId: 'TEX', year: 2011, name: '2011 Texas Rangers', tagline: 'One strike away, twice — the Rangers’ ride to remember', dh: true },
  // ---- National League East ----
  { franchise: 'Atlanta Braves', teamId: 'ATL', year: 1995, name: '1995 Atlanta Braves', tagline: 'The pitching dynasty finally takes the crown', dh: false },
  { franchise: 'Miami Marlins', teamId: 'FLO', year: 1997, name: '1997 Florida Marlins', tagline: 'A four-year-old franchise wins the whole thing', dh: false },
  { franchise: 'New York Mets', teamId: 'NYN', year: 1969, name: '1969 New York Mets', tagline: 'From the laughingstock to the Miracle Mets', dh: false },
  { franchise: 'Philadelphia Phillies', teamId: 'PHI', year: 1980, name: '1980 Philadelphia Phillies', tagline: 'Schmidt, Lefty, and the franchise’s first ring', dh: false },
  { franchise: 'Washington Nationals', teamId: 'WAS', year: 2019, name: '2019 Washington Nationals', tagline: 'Fight to the finish — the wild card that won it all', dh: false },
  // ---- National League Central ----
  { franchise: 'Chicago Cubs', teamId: 'CHN', year: 1908, name: '1908 Chicago Cubs', tagline: 'Tinker to Evers to Chance — the last Cubs crown for 108 years', dh: false },
  { franchise: 'Cincinnati Reds', teamId: 'CIN', year: 1975, name: '1975 Cincinnati Reds', tagline: 'The Big Red Machine at full throttle', dh: false },
  { franchise: 'Milwaukee Brewers', teamId: 'ML4', year: 1982, name: '1982 Milwaukee Brewers', tagline: 'Harvey’s Wallbangers — six boppers deep', dh: true },
  { franchise: 'Pittsburgh Pirates', teamId: 'PIT', year: 1979, name: '1979 Pittsburgh Pirates', tagline: 'We Are Family — Stargell and the Sisters take October', dh: false },
  { franchise: 'St. Louis Cardinals', teamId: 'SLN', year: 1942, name: '1942 St. Louis Cardinals', tagline: 'Musial arrives; the Redbirds topple the Yankees', dh: false },
  // ---- National League West ----
  { franchise: 'Arizona Diamondbacks', teamId: 'ARI', year: 2001, name: '2001 Arizona Diamondbacks', tagline: 'Randy, Schilling, and a Game 7 winner in the ninth', dh: false },
  { franchise: 'Colorado Rockies', teamId: 'COL', year: 2007, name: '2007 Colorado Rockies', tagline: 'Rocktober — 21 wins in 22 games to the pennant', dh: false },
  { franchise: 'Los Angeles Dodgers', teamId: 'BRO', year: 1955, name: '1955 Brooklyn Dodgers', tagline: 'Next year is finally this year', dh: false },
  { franchise: 'San Diego Padres', teamId: 'SDN', year: 1998, name: '1998 San Diego Padres', tagline: 'Gwynn’s greatest supporting cast wins the West big', dh: false },
  { franchise: 'San Francisco Giants', teamId: 'NY1', year: 1954, name: '1954 New York Giants', tagline: 'The Catch — Willie runs the Polo Grounds forever', dh: false },
];

const FIELD_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const;

interface PlayerRow {
  bbrefId: string;
  name: string;
  position: string;
}

/** One team-year's Lahman rows, merged into lookup maps. */
interface Roster {
  /** player → plate appearances with that team that year */
  pa: Map<string, number>;
  /** player → outs pitched with that team that year */
  ipOuts: Map<string, number>;
  /** position → player → games, from Fielding (OF kept separate) */
  gamesAt: Map<string, Map<string, number>>;
  /** LF/CF/RF → player → games, from FieldingOFsplit (pre-1954 outfield) */
  splitGamesAt: Map<string, Map<string, number>>;
}

interface PeopleTable extends CsvTable {
  index: Map<string, string[]>;
  c: { playerID: number; bbrefID: number; nameFirst: number; nameLast: number };
}

function nameOf(people: PeopleTable, playerId: string): string {
  const row = people.index.get(playerId);
  if (row !== undefined) {
    const first = optionalText(cell(row, people.c.nameFirst)) ?? '';
    const last = optionalText(cell(row, people.c.nameLast)) ?? '';
    const name = `${first} ${last}`.trim();
    if (name !== '') return name;
  }
  return playerId;
}

function bbrefOf(people: PeopleTable, playerId: string): string {
  const row = people.index.get(playerId);
  return (row !== undefined ? optionalText(cell(row, people.c.bbrefID)) : null) ?? playerId;
}

function loadPeople(text: string): PeopleTable {
  const table = parseCsvTable(text);
  const c = requireColumns(table, ['playerID', 'bbrefID', 'nameFirst', 'nameLast'], 'People.csv');
  const index = new Map<string, string[]>();
  for (const row of table.rows) index.set(cell(row, c.playerID).trim(), row);
  return { ...table, index, c };
}

function rosterOf(files: CsvFileMap, pick: Pick): Roster {
  const batting = parseCsvTable(files['Batting.csv'] ?? '');
  const bc = requireColumns(batting, ['playerID', 'yearID', 'teamID', 'AB', 'BB', 'HBP', 'SH', 'SF'], 'Batting.csv');
  const pitching = parseCsvTable(files['Pitching.csv'] ?? '');
  const pc = requireColumns(pitching, ['playerID', 'yearID', 'teamID', 'IPouts'], 'Pitching.csv');
  const fielding = parseCsvTable(files['Fielding.csv'] ?? '');
  const fc = requireColumns(fielding, ['playerID', 'yearID', 'teamID', 'POS', 'G'], 'Fielding.csv');
  const split = parseCsvTable(files['FieldingOFsplit.csv'] ?? '');
  const sc = requireColumns(split, ['playerID', 'yearID', 'teamID', 'POS', 'G'], 'FieldingOFsplit.csv');

  const pa = new Map<string, number>();
  const ipOuts = new Map<string, number>();
  const gamesAt = new Map<string, Map<string, number>>();
  const splitGamesAt = new Map<string, Map<string, number>>();

  const bump = (map: Map<string, number>, key: string, by: number) => map.set(key, (map.get(key) ?? 0) + by);

  for (const row of batting.rows) {
    if (num(cell(row, bc.yearID)) !== pick.year || cell(row, bc.teamID).trim() !== pick.teamId) continue;
    const player = cell(row, bc.playerID).trim();
    bump(pa, player, num(cell(row, bc.AB)) + num(cell(row, bc.BB)) + num(cell(row, bc.HBP)) + num(cell(row, bc.SH)) + num(cell(row, bc.SF)));
  }
  for (const row of pitching.rows) {
    if (num(cell(row, pc.yearID)) !== pick.year || cell(row, pc.teamID).trim() !== pick.teamId) continue;
    bump(ipOuts, cell(row, pc.playerID).trim(), num(cell(row, pc.IPouts)));
  }
  for (const row of fielding.rows) {
    if (num(cell(row, fc.yearID)) !== pick.year || cell(row, fc.teamID).trim() !== pick.teamId) continue;
    const pos = cell(row, fc.POS).trim();
    if (pos === '') continue;
    let bucket = gamesAt.get(pos);
    if (bucket === undefined) {
      bucket = new Map<string, number>();
      gamesAt.set(pos, bucket);
    }
    bump(bucket, cell(row, fc.playerID).trim(), num(cell(row, fc.G)));
  }
  for (const row of split.rows) {
    if (num(cell(row, sc.yearID)) !== pick.year || cell(row, sc.teamID).trim() !== pick.teamId) continue;
    const pos = cell(row, sc.POS).trim();
    if (pos !== 'LF' && pos !== 'CF' && pos !== 'RF') continue;
    let bucket = splitGamesAt.get(pos);
    if (bucket === undefined) {
      bucket = new Map<string, number>();
      splitGamesAt.set(pos, bucket);
    }
    bump(bucket, cell(row, sc.playerID).trim(), num(cell(row, sc.G)));
  }

  return { pa, ipOuts, gamesAt, splitGamesAt };
}

/** The player with the most games at a position (plate appearances break ties). */
function pickForPosition(roster: Roster, position: string, taken: Set<string>): string | null {
  const bucket = roster.gamesAt.get(position);
  if (bucket === undefined) return null;
  const ranked = [...bucket.entries()]
    .filter(([player]) => !taken.has(player))
    .sort((a, b) => b[1] - a[1] || (roster.pa.get(b[0]) ?? 0) - (roster.pa.get(a[0]) ?? 0));
  return ranked[0]?.[0] ?? null;
}

/** Outfielders, split into corners and center when the era has the split data. */
function outfielders(roster: Roster, taken: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set(taken);
  const positions = ['LF', 'CF', 'RF'] as const;

  if (positions.some((pos) => (roster.splitGamesAt.get(pos)?.size ?? 0) > 0)) {
    for (const pos of positions) {
      const bucket = roster.splitGamesAt.get(pos);
      if (bucket === undefined) continue;
      const ranked = [...bucket.entries()]
        .filter(([player]) => !used.has(player))
        .sort((a, b) => b[1] - a[1] || (roster.pa.get(b[0]) ?? 0) - (roster.pa.get(a[0]) ?? 0));
      if (ranked[0] !== undefined) {
        used.add(ranked[0][0]);
        out.set(pos, ranked[0][0]);
      }
    }
    return out;
  }

  // Pre-split data: the three outfielders with the most games, most first.
  const of = roster.gamesAt.get('OF');
  if (of === undefined) return out;
  const ranked = [...of.entries()]
    .filter(([player]) => !used.has(player))
    .sort((a, b) => b[1] - a[1] || (roster.pa.get(b[0]) ?? 0) - (roster.pa.get(a[0]) ?? 0));
  for (let i = 0; i < 3 && i < ranked.length; i++) {
    used.add(ranked[i]![0]);
    out.set(positions[i]!, ranked[i]![0]);
  }
  return out;
}

function buildTeam(files: CsvFileMap, people: PeopleTable, pick: Pick): { players: PlayerRow[]; warnings: string[] } {
  const roster = rosterOf(files, pick);
  const taken = new Set<string>();
  const players: PlayerRow[] = [];
  const warnings: string[] = [];
  const push = (position: string, playerId: string | null) => {
    if (playerId === null) {
      warnings.push(`${pick.name}: no ${position} found in the data`);
      return;
    }
    taken.add(playerId);
    players.push({ bbrefId: bbrefOf(people, playerId), name: nameOf(people, playerId), position });
  };

  for (const pos of FIELD_POSITIONS) {
    if (pos === 'LF' || pos === 'CF' || pos === 'RF') continue;
    push(pos, pickForPosition(roster, pos, taken));
  }
  for (const [pos, playerId] of outfielders(roster, taken)) {
    if (playerId !== undefined) push(pos, playerId);
  }
  if (pick.dh) {
    const ranked = [...roster.pa.entries()]
      .filter(([player]) => !taken.has(player))
      .sort((a, b) => b[1] - a[1]);
    push('DH', ranked[0]?.[0] ?? null);
  }

  // The staff: the three arms with the most outs, batters already taken aside.
  const arms = [...roster.ipOuts.entries()]
    .filter(([player]) => !taken.has(player))
    .sort((a, b) => b[1] - a[1]);
  push('SP', arms[0]?.[0] ?? null);
  for (const arm of arms.slice(1, 3)) push('RP', arm[0]);

  return { players, warnings };
}

function renderFile(teams: { pick: Pick; players: PlayerRow[] }[]): string {
  const lines: string[] = [
    '/**',
    ' * Historic team collection challenges.',
    ' *',
    ' * One iconic season from every active franchise, with its lineup pre-built',
    ' * from the record books: collect a card covering the season for every player',
    ' * listed and the collection is complete.',
    ' *',
    ' * GENERATED by `pnpm --filter @cardball/import-stats challenges` from the',
    ' * cached Lahman CSVs — edit the picks in tools/import-stats/src/challenges.ts',
    ' * and re-run; do not hand-edit the players.',
    ' */',
    '',
    "export interface HistoricPlayer {",
    "  /** Baseball-Reference id, matching `people.bbref_id` in the database */",
    '  bbrefId: string;',
    '  name: string;',
    '  /** lineup slot: C, 1B, 2B, 3B, SS, LF, CF, RF, DH, SP, RP */',
    '  position: string;',
    '}',
    '',
    'export interface HistoricTeam {',
    "  /** stable slug, e.g. 'sea-1995' */",
    '  id: string;',
    '  year: number;',
    '  /** what the team was called that season, e.g. “1955 Brooklyn Dodgers” */',
    '  name: string;',
    '  /** the franchise today, e.g. “Los Angeles Dodgers” */',
    '  franchise: string;',
    '  tagline: string;',
    '  players: HistoricPlayer[];',
    '}',
    '',
    'export const HISTORIC_TEAMS: readonly HistoricTeam[] = [',
  ];
  for (const { pick, players } of teams) {
    lines.push('  {');
    lines.push(`    id: '${pick.teamId.toLowerCase()}-${pick.year}',`);
    lines.push(`    year: ${pick.year},`);
    lines.push(`    name: ${JSON.stringify(pick.name)},`);
    lines.push(`    franchise: ${JSON.stringify(pick.franchise)},`);
    lines.push(`    tagline: ${JSON.stringify(pick.tagline)},`);
    lines.push('    players: [');
    for (const player of players) {
      lines.push(`      { bbrefId: ${JSON.stringify(player.bbrefId)}, name: ${JSON.stringify(player.name)}, position: ${JSON.stringify(player.position)} },`);
    }
    lines.push('    ],');
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');
  lines.push('export function historicTeamById(id: string): HistoricTeam | undefined {');
  lines.push('  return HISTORIC_TEAMS.find((team) => team.id === id);');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

const OUTPUT_PATH = fileURLToPath(new URL('../../../packages/shared/src/historicTeams.ts', import.meta.url));

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const files = await loadCsvFiles({ log: () => undefined });
  const people = loadPeople(files['People.csv'] ?? '');
  const teams: { pick: Pick; players: PlayerRow[] }[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  for (const pick of PICKS) {
    const id = `${pick.teamId.toLowerCase()}-${pick.year}`;
    if (ids.has(id)) throw new Error(`Duplicate challenge id ${id}`);
    ids.add(id);
    const built = buildTeam(files, people, pick);
    warnings.push(...built.warnings);
    if (built.players.length === 0) throw new Error(`${pick.name}: no players found — wrong teamID or year?`);
    teams.push({ pick, players: built.players });
  }

  const text = renderFile(teams);
  if (check) {
    const committed = await readFile(OUTPUT_PATH, 'utf8');
    if (committed !== text) {
      console.error('The committed historicTeams.ts is out of date — re-run the generator.');
      process.exitCode = 1;
    } else {
      console.log(`${PICKS.length} challenges, up to date.`);
    }
    return;
  }

  await writeFile(OUTPUT_PATH, text, 'utf8');
  console.log(`Wrote ${teams.length} challenges to ${OUTPUT_PATH}`);
  for (const warning of warnings) console.warn(`  warning: ${warning}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
