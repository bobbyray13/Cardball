/**
 * Build a team-year's roster from the Lahman CSVs.
 *
 * Shared by the historic-team collection generator (`challenges.ts`) and the
 * stock-team generator (`stockTeams.ts`). Both ask the same question — who
 * actually played where for this team that season? — so the answer lives here
 * once, read straight out of the cached CSV files.
 */
import { cell, num, optionalText, parseCsvTable, requireColumns } from './csv.js';
import type { CsvTable } from './csv.js';
import type { CsvFileMap } from './download.js';

/** The season a roster is drawn from, and whether that league-year had a DH. */
export interface RosterPick {
  /** Lahman franchise code for that season (the Brooklyn Dodgers are BRO). */
  teamId: string;
  year: number;
  dh: boolean;
}

export interface PlayerRow {
  bbrefId: string;
  name: string;
  position: string;
}

export interface PeopleTable extends CsvTable {
  index: Map<string, string[]>;
  c: { playerID: number; bbrefID: number; nameFirst: number; nameLast: number };
}

export function nameOf(people: PeopleTable, playerId: string): string {
  const row = people.index.get(playerId);
  if (row !== undefined) {
    const first = optionalText(cell(row, people.c.nameFirst)) ?? '';
    const last = optionalText(cell(row, people.c.nameLast)) ?? '';
    const name = `${first} ${last}`.trim();
    if (name !== '') return name;
  }
  return playerId;
}

export function bbrefOf(people: PeopleTable, playerId: string): string {
  const row = people.index.get(playerId);
  return (row !== undefined ? optionalText(cell(row, people.c.bbrefID)) : null) ?? playerId;
}

export function loadPeople(text: string): PeopleTable {
  const table = parseCsvTable(text);
  const c = requireColumns(table, ['playerID', 'bbrefID', 'nameFirst', 'nameLast'], 'People.csv');
  const index = new Map<string, string[]>();
  for (const row of table.rows) index.set(cell(row, c.playerID).trim(), row);
  return { ...table, index, c };
}

/** One team-year's Lahman rows, merged into lookup maps. */
export interface Roster {
  /** player → plate appearances with that team that year */
  pa: Map<string, number>;
  /** player → outs pitched with that team that year */
  ipOuts: Map<string, number>;
  /** player → true when a season anywhere made him a starter (100+ IP) */
  isStarter: Map<string, boolean>;
  /** position → player → games, from Fielding (OF kept separate) */
  gamesAt: Map<string, Map<string, number>>;
  /** LF/CF/RF → player → games, from FieldingOFsplit (pre-1954 outfield) */
  splitGamesAt: Map<string, Map<string, number>>;
}

/** Innings (not outs) in a season that mark a pitcher as a starter. */
export const STARTER_IP_THRESHOLD = 100;

export function rosterOf(files: CsvFileMap, pick: RosterPick): Roster {
  const batting = parseCsvTable(files['Batting.csv']);
  const bc = requireColumns(batting, ['playerID', 'yearID', 'teamID', 'AB', 'BB', 'HBP', 'SH', 'SF'], 'Batting.csv');
  const pitching = parseCsvTable(files['Pitching.csv']);
  const pc = requireColumns(pitching, ['playerID', 'yearID', 'teamID', 'IPouts'], 'Pitching.csv');
  const fielding = parseCsvTable(files['Fielding.csv']);
  const fc = requireColumns(fielding, ['playerID', 'yearID', 'teamID', 'POS', 'G'], 'Fielding.csv');
  const split = parseCsvTable(files['FieldingOFsplit.csv']);
  const sc = requireColumns(split, ['playerID', 'yearID', 'teamID', 'POS', 'G'], 'FieldingOFsplit.csv');

  const pa = new Map<string, number>();
  const ipOuts = new Map<string, number>();
  const isStarter = new Map<string, boolean>();
  const gamesAt = new Map<string, Map<string, number>>();
  const splitGamesAt = new Map<string, Map<string, number>>();

  const bump = (map: Map<string, number>, key: string, by: number) => map.set(key, (map.get(key) ?? 0) + by);

  for (const row of batting.rows) {
    if (num(cell(row, bc.yearID)) !== pick.year || cell(row, bc.teamID).trim() !== pick.teamId) continue;
    const player = cell(row, bc.playerID).trim();
    bump(pa, player, num(cell(row, bc.AB)) + num(cell(row, bc.BB)) + num(cell(row, bc.HBP)) + num(cell(row, bc.SH)) + num(cell(row, bc.SF)));
  }
  // A starter is a starter because of a season anywhere, so scan every row.
  for (const row of pitching.rows) {
    const player = cell(row, pc.playerID).trim();
    if (num(cell(row, pc.IPouts)) >= STARTER_IP_THRESHOLD * 3) isStarter.set(player, true);
    if (num(cell(row, pc.yearID)) !== pick.year || cell(row, pc.teamID).trim() !== pick.teamId) continue;
    bump(ipOuts, player, num(cell(row, pc.IPouts)));
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

  return { pa, ipOuts, isStarter, gamesAt, splitGamesAt };
}

/** The player with the most games at a position (plate appearances break ties). */
export function pickForPosition(roster: Roster, position: string, taken: Set<string>): string | null {
  const bucket = roster.gamesAt.get(position);
  if (bucket === undefined) return null;
  const ranked = [...bucket.entries()]
    .filter(([player]) => !taken.has(player))
    .sort((a, b) => b[1] - a[1] || (roster.pa.get(b[0]) ?? 0) - (roster.pa.get(a[0]) ?? 0));
  return ranked[0]?.[0] ?? null;
}

/** Outfielders, split into corners and center when the era has the split data. */
export function outfielders(roster: Roster, taken: Set<string>): Map<string, string> {
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

export const FIELD_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const;

/**
 * The starting lineup plus a staff, read off the season. Eight fielders, a DH
 * when the league-year had one, and the three busiest arms as SP + two RPs.
 */
export function buildTeam(files: CsvFileMap, people: PeopleTable, pick: RosterPick): { players: PlayerRow[]; warnings: string[] } {
  const roster = rosterOf(files, pick);
  const taken = new Set<string>();
  const players: PlayerRow[] = [];
  const warnings: string[] = [];
  const push = (position: string, playerId: string | null) => {
    if (playerId === null) {
      warnings.push(`${pick.teamId} ${pick.year}: no ${position} found in the data`);
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
    const ranked = [...roster.pa.entries()].filter(([player]) => !taken.has(player)).sort((a, b) => b[1] - a[1]);
    push('DH', ranked[0]?.[0] ?? null);
  }

  // The staff: the three arms with the most outs, batters already taken aside.
  const arms = [...roster.ipOuts.entries()].filter(([player]) => !taken.has(player)).sort((a, b) => b[1] - a[1]);
  push('SP', arms[0]?.[0] ?? null);
  for (const arm of arms.slice(1, 3)) push('RP', arm[0]);

  return { players, warnings };
}

/** Bench bats and bullpen arms, so a stock team has depth for a real game. */
export function buildBench(files: CsvFileMap, people: PeopleTable, pick: RosterPick, taken: Set<string>): PlayerRow[] {
  const roster = rosterOf(files, pick);
  const bench: PlayerRow[] = [];
  const used = new Set(taken);
  const push = (playerId: string, position: string) => {
    if (used.has(playerId)) return;
    used.add(playerId);
    bench.push({ bbrefId: bbrefOf(people, playerId), name: nameOf(people, playerId), position });
  };

  // A backup who actually played each field position, most-used first.
  for (const pos of FIELD_POSITIONS) {
    const player = pickForPosition(roster, pos, used);
    if (player !== null) push(player, pos);
  }

  // Two true relievers (never a 100-inning starter), so the bullpen can pitch
  // the innings the rules reserve for it.
  const relievers = [...roster.ipOuts.entries()]
    .filter(([player]) => !used.has(player) && roster.isStarter.get(player) !== true)
    .sort((a, b) => b[1] - a[1]);
  for (const [player] of relievers.slice(0, 2)) push(player, 'RP');

  // The best remaining bats, for a bench.
  const bats = [...roster.pa.entries()].filter(([player]) => !used.has(player)).sort((a, b) => b[1] - a[1]);
  for (const [player] of bats.slice(0, 4)) push(player, 'DH');

  return bench;
}

/**
 * A full, game-ready roster for a stock team: the eight fielders and a DH the
 * engine requires, a real starting pitcher (a 100-inning arm, never a pure
 * reliever), a couple more arms, and a bench. Used by the stock-team catalog,
 * which the bot plays from.
 */
export function buildStockRoster(files: CsvFileMap, people: PeopleTable, pick: RosterPick): { players: PlayerRow[]; warnings: string[] } {
  const roster = rosterOf(files, pick);
  const taken = new Set<string>();
  const players: PlayerRow[] = [];
  const warnings: string[] = [];
  const push = (position: string, playerId: string | null) => {
    if (playerId === null) {
      warnings.push(`${pick.teamId} ${pick.year}: no ${position} found in the data`);
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

  // The engine requires a designated hitter whatever the era, so always take
  // the best bat left over for the ninth spot.
  const bats = [...roster.pa.entries()].filter(([player]) => !taken.has(player)).sort((a, b) => b[1] - a[1]);
  push('DH', bats[0]?.[0] ?? null);

  // The mound: a genuine starter first, then the busiest arms still available.
  const arms = [...roster.ipOuts.entries()].filter(([player]) => !taken.has(player)).sort((a, b) => b[1] - a[1]);
  const starter = arms.find(([player]) => roster.isStarter.get(player) === true) ?? arms[0];
  push('SP', starter?.[0] ?? null);
  for (const [player] of arms.filter(([player]) => !taken.has(player)).slice(0, 2)) push('RP', player);

  for (const bench of buildBench(files, people, pick, taken)) players.push(bench);

  return { players, warnings };
}
