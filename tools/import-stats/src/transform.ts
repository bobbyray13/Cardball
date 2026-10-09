/**
 * Turns the raw Lahman CSVs into the rows Cardball's `people` / `seasons`
 * tables want. All of the interesting logic lives in the pure modules
 * (`merge.ts`, `fielding.ts`, `rating.ts`); this file is the plumbing that
 * reads the tables, groups them by (player, year) and assembles the dataset.
 */
import { POSITIONS, RULES_CONFIG } from '@cardball/shared';
import type { Position } from '@cardball/shared';
import {
  cell,
  firstCharOrNull,
  num,
  optionalText,
  parseCsvTable,
  requireColumns,
  yearFromDate,
} from './csv.js';
import {
  accumulateOfGames,
  mostPlayedOfSpot,
  resolveOutfieldRows,
  type OfGamesByField,
  type OutfieldSpot,
} from './fielding.js';
import {
  appearanceGames,
  buildTeamLabel,
  mergeBatting,
  mergePitching,
  type MergedBatting,
  type MergedPitching,
} from './merge.js';
import { computeFieldingRatings, ratingKey, type FieldingCandidate } from './rating.js';
import type {
  BattingStint,
  FieldingStint,
  FieldingTotals,
  ParsedDataset,
  PersonSeed,
  PitchingStint,
  PositionPlayed,
  SeasonSeed,
} from './types.js';

export interface BuildOptions {
  log?: (message: string) => void;
}

/** Lahman positions we understand (everything else is reported and skipped). */
const KNOWN_POSITIONS = new Set<string>(['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'P']);

function positionOrder(position: Position): number {
  const at = POSITIONS.indexOf(position);
  return at < 0 ? POSITIONS.length : at;
}

function yearValue(value: string | undefined): number | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

function seasonKey(playerId: string, year: number): string {
  return `${playerId}|${year}`;
}

// ---------------------------------------------------------------------------
// Row parsers
// ---------------------------------------------------------------------------

function parseBatting(text: string): BattingStint[] {
  const table = parseCsvTable(text);
  const c = requireColumns(
    table,
    [
      'playerID',
      'yearID',
      'stint',
      'teamID',
      'G',
      'AB',
      'H',
      '2B',
      '3B',
      'HR',
      'RBI',
      'SB',
      'BB',
      'HBP',
      'SH',
      'SF',
    ] as const,
    'Batting.csv',
  );
  const stints: BattingStint[] = [];
  for (const row of table.rows) {
    const playerId = cell(row, c.playerID).trim();
    const year = yearValue(cell(row, c.yearID));
    if (playerId === '' || year === null) continue;
    stints.push({
      playerId,
      year,
      stint: num(cell(row, c.stint)),
      teamId: cell(row, c.teamID).trim(),
      games: num(cell(row, c.G)),
      ab: num(cell(row, c.AB)),
      h: num(cell(row, c.H)),
      doubles: num(cell(row, c['2B'])),
      triples: num(cell(row, c['3B'])),
      homeRuns: num(cell(row, c.HR)),
      rbi: num(cell(row, c.RBI)),
      sb: num(cell(row, c.SB)),
      bb: num(cell(row, c.BB)),
      hbp: num(cell(row, c.HBP)),
      sh: num(cell(row, c.SH)),
      sf: num(cell(row, c.SF)),
    });
  }
  return stints;
}

function parsePitching(text: string): PitchingStint[] {
  const table = parseCsvTable(text);
  const c = requireColumns(
    table,
    ['playerID', 'yearID', 'stint', 'teamID', 'G', 'IPouts', 'ER', 'BFP'] as const,
    'Pitching.csv',
  );
  // The counting stats every Lahman release carries. Read softly, so an
  // unusual mirror missing one column imports zeros instead of failing.
  const at = (name: string) => table.header.indexOf(name);
  const cSo = at('SO');
  const cBb = at('BB');
  const cH = at('H');
  const cW = at('W');
  const cL = at('L');
  const cSv = at('SV');
  const stints: PitchingStint[] = [];
  for (const row of table.rows) {
    const playerId = cell(row, c.playerID).trim();
    const year = yearValue(cell(row, c.yearID));
    if (playerId === '' || year === null) continue;
    stints.push({
      playerId,
      year,
      stint: num(cell(row, c.stint)),
      teamId: cell(row, c.teamID).trim(),
      games: num(cell(row, c.G)),
      ipOuts: num(cell(row, c.IPouts)),
      er: num(cell(row, c.ER)),
      bf: num(cell(row, c.BFP)),
      so: cSo >= 0 ? num(cell(row, cSo)) : 0,
      bb: cBb >= 0 ? num(cell(row, cBb)) : 0,
      h: cH >= 0 ? num(cell(row, cH)) : 0,
      w: cW >= 0 ? num(cell(row, cW)) : 0,
      l: cL >= 0 ? num(cell(row, cL)) : 0,
      sv: cSv >= 0 ? num(cell(row, cSv)) : 0,
    });
  }
  return stints;
}

interface FieldingParse {
  rows: FieldingStint[];
  unknownPositions: Map<string, number>;
}

function parseFielding(text: string, fileName: string): FieldingParse {
  const table = parseCsvTable(text);
  const c = requireColumns(
    table,
    ['playerID', 'yearID', 'stint', 'teamID', 'POS', 'G', 'InnOuts', 'PO', 'A', 'E'] as const,
    fileName,
  );
  const sbColumn = table.header.indexOf('SB');
  const csColumn = table.header.indexOf('CS');
  const rows: FieldingStint[] = [];
  const unknownPositions = new Map<string, number>();

  for (const row of table.rows) {
    const playerId = cell(row, c.playerID).trim();
    const year = yearValue(cell(row, c.yearID));
    const position = cell(row, c.POS).trim().toUpperCase();
    if (playerId === '' || year === null) continue;
    if (position !== 'OF' && !KNOWN_POSITIONS.has(position)) {
      unknownPositions.set(position, (unknownPositions.get(position) ?? 0) + 1);
      continue;
    }
    rows.push({
      playerId,
      year,
      stint: num(cell(row, c.stint)),
      teamId: cell(row, c.teamID).trim(),
      position,
      games: num(cell(row, c.G)),
      innOuts: num(cell(row, c.InnOuts)),
      po: num(cell(row, c.PO)),
      assists: num(cell(row, c.A)),
      errors: num(cell(row, c.E)),
      sb: sbColumn < 0 ? 0 : num(cell(row, sbColumn)),
      cs: csColumn < 0 ? 0 : num(cell(row, csColumn)),
    });
  }
  return { rows, unknownPositions };
}

/** `FieldingOF.csv`: games by outfield spot, per player-season. */
function parseFieldingOf(text: string): Map<string, OfGamesByField> {
  const table = parseCsvTable(text);
  const c = requireColumns(table, ['playerID', 'yearID', 'Glf', 'Gcf', 'Grf'] as const, 'FieldingOF.csv');
  const totals = new Map<string, OfGamesByField>();
  for (const row of table.rows) {
    const playerId = cell(row, c.playerID).trim();
    const year = yearValue(cell(row, c.yearID));
    if (playerId === '' || year === null) continue;
    totals.set(seasonKey(playerId, year), {
      LF: num(cell(row, c.Glf)),
      CF: num(cell(row, c.Gcf)),
      RF: num(cell(row, c.Grf)),
    });
  }
  return totals;
}

/** `Appearances.csv`: the authoritative games-played figure, `G_all`. */
function parseAppearances(text: string): Map<string, number> {
  const table = parseCsvTable(text);
  const c = requireColumns(table, ['playerID', 'yearID', 'G_all'] as const, 'Appearances.csv');
  const games = new Map<string, number>();
  for (const row of table.rows) {
    const playerId = cell(row, c.playerID).trim();
    const year = yearValue(cell(row, c.yearID));
    if (playerId === '' || year === null) continue;
    // One row per team stint, so a mid-season trade adds both halves up.
    const key = seasonKey(playerId, year);
    games.set(key, (games.get(key) ?? 0) + num(cell(row, c.G_all)));
  }
  return games;
}

function parsePeople(text: string): PersonSeed[] {
  const table = parseCsvTable(text);
  const c = requireColumns(
    table,
    [
      'playerID',
      'bbrefID',
      'nameFirst',
      'nameLast',
      'nameGiven',
      'bats',
      'throws',
      'debut',
      'finalGame',
    ] as const,
    'People.csv',
  );
  const people: PersonSeed[] = [];
  for (const row of table.rows) {
    const playerId = cell(row, c.playerID).trim();
    if (playerId === '') continue;
    const bbrefId = optionalText(cell(row, c.bbrefID)) ?? playerId;
    const nameGiven = optionalText(cell(row, c.nameGiven));
    const givenParts = (nameGiven ?? '').split(/\s+/).filter((part) => part !== '');
    people.push({
      playerId,
      bbrefId,
      nameFirst: optionalText(cell(row, c.nameFirst)) ?? givenParts[0] ?? playerId,
      nameLast: optionalText(cell(row, c.nameLast)) ?? givenParts.slice(1).join(' '),
      nameGiven,
      bats: firstCharOrNull(cell(row, c.bats)),
      throws: firstCharOrNull(cell(row, c.throws)),
      debutYear: yearFromDate(cell(row, c.debut)),
      finalYear: yearFromDate(cell(row, c.finalGame)),
      isStarter: false, // filled in once the pitching seasons are merged
    });
  }
  return people;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

interface Accumulator {
  playerId: string;
  year: number;
  batting: BattingStint[];
  pitching: PitchingStint[];
  fielding: FieldingStint[];
  appearancesGames: number | null;
}

function accumulatorFor(map: Map<string, Accumulator>, playerId: string, year: number): Accumulator {
  const key = seasonKey(playerId, year);
  let acc = map.get(key);
  if (acc === undefined) {
    acc = { playerId, year, batting: [], pitching: [], fielding: [], appearancesGames: null };
    map.set(key, acc);
  }
  return acc;
}

export function buildDataset(files: Record<string, string>, options: BuildOptions = {}): ParsedDataset {
  const log = options.log ?? ((): void => undefined);

  const people = parsePeople(files['People.csv'] ?? '');
  log(`People.csv        ${people.length} people`);

  const batting = parseBatting(files['Batting.csv'] ?? '');
  log(`Batting.csv       ${batting.length} batting stints`);

  const pitching = parsePitching(files['Pitching.csv'] ?? '');
  log(`Pitching.csv      ${pitching.length} pitching stints`);

  const fielding = parseFielding(files['Fielding.csv'] ?? '', 'Fielding.csv');
  log(`Fielding.csv      ${fielding.rows.length} fielding stints`);
  for (const [position, count] of fielding.unknownPositions) {
    log(`  note: skipped ${count} rows with unrecognised POS "${position}"`);
  }

  const split = parseFielding(files['FieldingOFsplit.csv'] ?? '', 'FieldingOFsplit.csv');
  log(`FieldingOFsplit   ${split.rows.length} outfield-split stints`);

  const ofTotals = parseFieldingOf(files['FieldingOF.csv'] ?? '');
  const appearances = parseAppearances(files['Appearances.csv'] ?? '');

  // Games per outfield spot over the player's whole career (pre-1954 fallback).
  const careerOfGames = new Map<string, OfGamesByField>();
  const splitRowsBySeason = new Map<string, FieldingStint[]>();
  for (const row of split.rows) {
    accumulateOfGames(careerOfGames, row.playerId, row);
    if (row.position === 'OF' || row.position === 'P') continue;
    const key = seasonKey(row.playerId, row.year);
    const bucket = splitRowsBySeason.get(key);
    if (bucket === undefined) splitRowsBySeason.set(key, [row]);
    else bucket.push(row);
  }

  // Every (player, year) any file knows about gets a season row.
  const seasons = new Map<string, Accumulator>();
  for (const stint of batting) accumulatorFor(seasons, stint.playerId, stint.year).batting.push(stint);
  for (const stint of pitching) {
    accumulatorFor(seasons, stint.playerId, stint.year).pitching.push(stint);
  }
  for (const row of fielding.rows) {
    accumulatorFor(seasons, row.playerId, row.year).fielding.push(row);
  }
  for (const [key, games] of appearances) {
    const acc = seasons.get(key);
    if (acc !== undefined) acc.appearancesGames = games;
    else {
      const [playerId, yearText] = key.split('|') as [string, string];
      accumulatorFor(seasons, playerId, Number(yearText)).appearancesGames = games;
    }
  }
  log(`Merging ${seasons.size} player-seasons ...`);

  const candidates: FieldingCandidate[] = [];
  const prepared: {
    acc: Accumulator;
    batting: MergedBatting;
    pitching: MergedPitching;
    positions: { position: Position; totals: FieldingTotals }[];
    teamLabel: string;
    games: number;
  }[] = [];

  for (const acc of seasons.values()) {
    const mergedBatting = mergeBatting(acc.batting);
    const mergedPitching = mergePitching(acc.pitching);

    const ofRows = acc.fielding.filter((row) => row.position === 'OF');
    const directRows = acc.fielding.filter((row) => row.position !== 'OF');
    const key = seasonKey(acc.playerId, acc.year);
    const careerGames = careerOfGames.get(acc.playerId);
    const careerSpot: OutfieldSpot | null =
      careerGames !== undefined && careerGames.LF + careerGames.CF + careerGames.RF > 0
        ? mostPlayedOfSpot(careerGames)
        : null;
    const resolvedOf = resolveOutfieldRows({
      ofRows,
      splitRows: splitRowsBySeason.get(key) ?? [],
      ofTotals: ofTotals.get(key) ?? null,
      careerSpot,
    });

    const totalsByPosition = new Map<string, FieldingTotals>();
    let fieldingGames = 0;
    for (const row of [...directRows, ...resolvedOf]) {
      if (!KNOWN_POSITIONS.has(row.position)) continue;
      let totals = totalsByPosition.get(row.position);
      if (totals === undefined) {
        totals = { games: 0, innOuts: 0, po: 0, assists: 0, errors: 0, sb: 0, cs: 0 };
        totalsByPosition.set(row.position, totals);
      }
      totals.games += row.games;
      totals.innOuts += row.innOuts;
      totals.po += row.po;
      totals.assists += row.assists;
      totals.errors += row.errors;
      totals.sb += row.sb;
      totals.cs += row.cs;
      fieldingGames += row.games;
    }

    const positions: { position: Position; totals: FieldingTotals }[] = [];
    for (const [position, totals] of totalsByPosition) {
      if (totals.games <= 0) continue;
      const typed = position as Position;
      positions.push({ position: typed, totals });
      if (typed !== 'P') {
        candidates.push({
          playerId: acc.playerId,
          year: acc.year,
          position: typed,
          games: totals.games,
          innOuts: totals.innOuts,
          po: totals.po,
          assists: totals.assists,
          errors: totals.errors,
          sb: totals.sb,
          cs: totals.cs,
        });
      }
    }

    const stints = [
      ...acc.batting.map((stint) => ({ stint: stint.stint, teamId: stint.teamId })),
      ...acc.pitching.map((stint) => ({ stint: stint.stint, teamId: stint.teamId })),
      ...acc.fielding.map((row) => ({ stint: row.stint, teamId: row.teamId })),
    ];

    prepared.push({
      acc,
      batting: mergedBatting,
      pitching: mergedPitching,
      positions,
      teamLabel: buildTeamLabel(stints),
      games: appearanceGames({
        appearancesGames: acc.appearancesGames,
        battingGames: mergedBatting.games,
        pitchingGames: mergedPitching.games,
        fieldingGames,
      }),
    });
  }

  const ratings = computeFieldingRatings(candidates);
  log(`Fielding ratings  ${ratings.size} rated player-seasons at a position`);

  const peopleById = new Map(people.map((person) => [person.playerId, person]));
  const peopleByBbref = new Map<string, PersonSeed[]>();
  for (const person of people) {
    const bucket = peopleByBbref.get(person.bbrefId);
    if (bucket === undefined) peopleByBbref.set(person.bbrefId, [person]);
    else bucket.push(person);
  }
  const starterThreshold = RULES_CONFIG.starterIpThreshold * 3; // innings -> outs
  const seasonSeeds: SeasonSeed[] = prepared.map((entry) => {
    const person = peopleById.get(entry.acc.playerId);
    const bbrefId = person?.bbrefId ?? entry.acc.playerId;
    if (entry.pitching.ipOuts >= starterThreshold) {
      // Flag every person row sharing this bbrefID; the writer keeps one of them.
      for (const twin of peopleByBbref.get(bbrefId) ?? []) twin.isStarter = true;
    }

    const positionsPlayed: PositionPlayed[] = entry.positions
      .map(({ position, totals }) => ({
        position,
        games: totals.games,
        rating: ratings.get(ratingKey(entry.acc.playerId, entry.acc.year, position)) ?? 0,
      }))
      .sort((a, b) => b.games - a.games || positionOrder(a.position) - positionOrder(b.position));

    let primaryPosition: Position | null = null;
    for (const played of positionsPlayed) {
      if (played.position === 'P') continue;
      primaryPosition = played.position;
      break;
    }

    return {
      bbrefId: person?.bbrefId ?? entry.acc.playerId,
      year: entry.acc.year,
      teamLabel: entry.teamLabel,
      games: entry.games,
      ab: entry.batting.ab,
      h: entry.batting.h,
      avg: entry.batting.avg,
      doubles: entry.batting.doubles,
      triples: entry.batting.triples,
      homeRuns: entry.batting.homeRuns,
      rbi: entry.batting.rbi,
      sb: entry.batting.sb,
      pa: entry.batting.pa,
      pitchGames: entry.pitching.games,
      pitchIpOuts: entry.pitching.ipOuts,
      pitchEra: entry.pitching.era,
      pitchBf: entry.pitching.bf,
      pitchSo: entry.pitching.so,
      pitchBb: entry.pitching.bb,
      pitchH: entry.pitching.h,
      pitchW: entry.pitching.w,
      pitchL: entry.pitching.l,
      pitchSv: entry.pitching.sv,
      primaryPosition,
      positionsPlayed,
    };
  });

  seasonSeeds.sort((a, b) =>
    a.bbrefId === b.bbrefId ? a.year - b.year : a.bbrefId < b.bbrefId ? -1 : 1,
  );

  // An active player's final game hasn't happened yet, so People.csv leaves
  // `finalGame` blank (and sometimes `debut` too). The merged seasons know the
  // years he actually played, so backfill the career span from them: the app
  // builds card years from it, and without a final year a current player
  // cannot have a card at all.
  const spanByBbref = new Map<string, { min: number; max: number }>();
  for (const season of seasonSeeds) {
    const span = spanByBbref.get(season.bbrefId);
    if (span === undefined) spanByBbref.set(season.bbrefId, { min: season.year, max: season.year });
    else {
      if (season.year < span.min) span.min = season.year;
      if (season.year > span.max) span.max = season.year;
    }
  }
  for (const person of people) {
    const span = spanByBbref.get(person.bbrefId);
    if (span === undefined) continue;
    if (person.debutYear === null) person.debutYear = span.min;
    // `finalYear < span.max` also heals rows written by an older, shorter dataset.
    if (person.finalYear === null || person.finalYear < span.max) person.finalYear = span.max;
  }

  return { people, seasons: seasonSeeds };
}

/** Small helper so the CLI can report what it parsed without touching the DB. */
export function summarizeDataset(dataset: ParsedDataset): {
  people: number;
  /** People.csv rows read, before rows sharing a bbrefID collapse. */
  peopleRows: number;
  seasons: number;
  minYear: number | null;
  maxYear: number | null;
  starters: number;
} {
  let minYear: number | null = null;
  let maxYear: number | null = null;
  for (const season of dataset.seasons) {
    if (minYear === null || season.year < minYear) minYear = season.year;
    if (maxYear === null || season.year > maxYear) maxYear = season.year;
  }
  const byBbref = new Map<string, PersonSeed>();
  for (const person of dataset.people) {
    const existing = byBbref.get(person.bbrefId);
    if (existing === undefined) byBbref.set(person.bbrefId, person);
    else if (person.isStarter) existing.isStarter = true;
  }
  return {
    people: byBbref.size,
    peopleRows: dataset.people.length,
    seasons: dataset.seasons.length,
    minYear,
    maxYear,
    starters: [...byBbref.values()].filter((person) => person.isStarter).length,
  };
}
