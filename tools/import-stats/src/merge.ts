/**
 * Pure stint-merging helpers: one Lahman player can have several rows per season
 * (one per team/stint). Cardball stores a single row per (player, year).
 */
import type { BattingStint, FieldingStint, FieldingTotals, PitchingStint } from './types.js';

export interface MergedBatting {
  games: number;
  ab: number;
  h: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  rbi: number;
  sb: number;
  pa: number;
  avg: number | null;
}

export interface MergedPitching {
  games: number;
  ipOuts: number;
  er: number;
  bf: number;
  era: number | null;
}

/** Batting average, or null when the season has no official at-bats. */
export function battingAverage(h: number, ab: number): number | null {
  return ab > 0 ? h / ab : null;
}

/** PA = AB + BB + HBP + SH + SF (Lahman blanks already normalised to 0). */
export function plateAppearances(
  ab: number,
  bb: number,
  hbp: number,
  sh: number,
  sf: number,
): number {
  return ab + bb + hbp + sh + sf;
}

/** ERA = 9 * ER / IP. Lahman stores outs, so 27 * ER / IPouts. */
export function earnedRunAverage(er: number, ipOuts: number): number | null {
  return ipOuts > 0 ? (er * 27) / ipOuts : null;
}

export function mergeBatting(stints: readonly BattingStint[]): MergedBatting {
  let games = 0;
  let ab = 0;
  let h = 0;
  let doubles = 0;
  let triples = 0;
  let homeRuns = 0;
  let rbi = 0;
  let sb = 0;
  let bb = 0;
  let hbp = 0;
  let sh = 0;
  let sf = 0;

  for (const stint of stints) {
    games += stint.games;
    ab += stint.ab;
    h += stint.h;
    doubles += stint.doubles;
    triples += stint.triples;
    homeRuns += stint.homeRuns;
    rbi += stint.rbi;
    sb += stint.sb;
    bb += stint.bb;
    hbp += stint.hbp;
    sh += stint.sh;
    sf += stint.sf;
  }

  return {
    games,
    ab,
    h,
    doubles,
    triples,
    homeRuns,
    rbi,
    sb,
    pa: plateAppearances(ab, bb, hbp, sh, sf),
    avg: battingAverage(h, ab),
  };
}

export function mergePitching(stints: readonly PitchingStint[]): MergedPitching {
  let games = 0;
  let ipOuts = 0;
  let er = 0;
  let bf = 0;

  for (const stint of stints) {
    games += stint.games;
    ipOuts += stint.ipOuts;
    er += stint.er;
    bf += stint.bf;
  }

  return { games, ipOuts, er, bf, era: earnedRunAverage(er, ipOuts) };
}

/** Sums every fielding stint the player had at one position in one season. */
export function mergeFielding(
  stints: readonly FieldingStint[],
  position: string,
): FieldingTotals {
  const totals: FieldingTotals = {
    games: 0,
    innOuts: 0,
    po: 0,
    assists: 0,
    errors: 0,
    sb: 0,
    cs: 0,
  };
  for (const stint of stints) {
    if (stint.position !== position) continue;
    totals.games += stint.games;
    totals.innOuts += stint.innOuts;
    totals.po += stint.po;
    totals.assists += stint.assists;
    totals.errors += stint.errors;
    totals.sb += stint.sb;
    totals.cs += stint.cs;
  }
  return totals;
}

export interface TeamStint {
  stint: number;
  teamId: string;
}

/**
 * `teamLabel` = the teams the player appeared for that year, in stint order,
 * joined with "/". Rows from different files (batting/pitching/fielding) that
 * describe the same stint are collapsed; genuine repeat stints are kept.
 */
export function buildTeamLabel(stints: readonly TeamStint[]): string {
  const seen = new Set<string>();
  const pairs: { stint: number; teamId: string; order: number }[] = [];

  stints.forEach((stint, order) => {
    const teamId = (stint.teamId ?? '').trim();
    if (teamId === '') return;
    const stintNumber = Number.isFinite(stint.stint) ? stint.stint : order;
    const key = `${stintNumber}|${teamId}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ stint: stintNumber, teamId, order });
  });

  pairs.sort((a, b) => a.stint - b.stint || a.order - b.order);
  return pairs.map((pair) => pair.teamId).join('/');
}

/**
 * Games played in the season. `Appearances.csv`'s `G_all` is the authoritative
 * appearance count (it counts games where the player never batted or fielded);
 * when it is missing for an old season we fall back to the largest number of
 * games reported by any other file, which never underestimates.
 */
export function appearanceGames(input: {
  appearancesGames: number | null;
  battingGames: number;
  pitchingGames: number;
  fieldingGames: number;
}): number {
  if (input.appearancesGames !== null && input.appearancesGames > 0) return input.appearancesGames;
  return Math.max(input.battingGames, input.pitchingGames, input.fieldingGames);
}

export interface MergeablePerson {
  playerId: string;
  bbrefId: string;
  debutYear: number | null;
}

/**
 * A handful of People.csv rows share a bbrefID (Lahman data artefacts, e.g.
 * `hallch02`/`hallch03`). Only one person row can own that bbrefID, so keep the
 * most credible one: the row whose playerID *is* the bbrefID, else one that
 * actually has a debut date.
 */
export function preferPerson<T extends MergeablePerson>(a: T, b: T): T {
  const score = (person: MergeablePerson): number =>
    (person.playerId === person.bbrefId ? 2 : 0) + (person.debutYear !== null ? 1 : 0);
  return score(b) > score(a) ? b : a;
}
