/**
 * Fielding-position helpers.
 *
 * `Fielding.csv` records every outfielder as a single `OF` position (true for
 * all seasons in the 1871-2025 release, not just the pre-1954 ones). The
 * LF/CF/RF breakdown lives in two companion files:
 *
 *   FieldingOFsplit.csv  1954+ — games and full fielding stats per LF/CF/RF
 *   FieldingOF.csv       1871-1955 — games by field, no stat breakdown
 *
 * When neither covers a season we attribute the legacy `OF` row to the player's
 * most-played outfield spot (career, from the split file), defaulting to CF.
 */
import type { FieldingStint } from './types.js';

export type OutfieldSpot = 'LF' | 'CF' | 'RF';

export const OUTFIELD_SPOTS: readonly OutfieldSpot[] = ['LF', 'CF', 'RF'];

/** Positions that live in the `Fielding.csv` POS column. */
export const FIELDING_POSITIONS: readonly string[] = [
  'C',
  '1B',
  '2B',
  '3B',
  'SS',
  'LF',
  'CF',
  'RF',
  'P',
  'OF',
];

export interface OfGamesByField {
  LF: number;
  CF: number;
  RF: number;
}

export function emptyOfGames(): OfGamesByField {
  return { LF: 0, CF: 0, RF: 0 };
}

export function isOutfieldSpot(value: string): value is OutfieldSpot {
  return value === 'LF' || value === 'CF' || value === 'RF';
}

/** Outfield spot with the most games; `fallback` when the totals are silent. */
export function mostPlayedOfSpot(
  games: OfGamesByField,
  fallback: OutfieldSpot = 'CF',
): OutfieldSpot {
  let best: OutfieldSpot | null = null;
  let bestGames = 0;
  for (const spot of OUTFIELD_SPOTS) {
    if (games[spot] > bestGames) {
      best = spot;
      bestGames = games[spot];
    }
  }
  return best ?? fallback;
}

export interface ResolveOutfieldArgs {
  /** `Fielding.csv` rows whose POS was the legacy `OF`. */
  ofRows: readonly FieldingStint[];
  /** `FieldingOFsplit.csv` rows for the same player-season (POS is LF/CF/RF). */
  splitRows: readonly FieldingStint[];
  /** `FieldingOF.csv` games-by-field for the same player-season, if any. */
  ofTotals?: OfGamesByField | null;
  /** The player's most-played outfield spot across their whole career, if known. */
  careerSpot?: OutfieldSpot | null;
}

/**
 * Builds the season's outfield rows: the split file's LF/CF/RF rows, plus a
 * fallback row for any legacy `OF` stint the split file does not cover.
 * Detail comes from the split file row-by-row; uncovered rows fall back to the
 * season's games-by-field, then the player's career outfield spot, then CF.
 */
export function resolveOutfieldRows(args: ResolveOutfieldArgs): FieldingStint[] {
  const { ofRows, splitRows, ofTotals, careerSpot } = args;
  const out: FieldingStint[] = [...splitRows];
  if (ofRows.length === 0) return out;

  const splitStints = new Set(splitRows.map((row) => row.stint));
  // The split file sometimes numbers stints differently; when nothing matches we
  // trust it to describe the whole season rather than double-counting games.
  if (splitRows.length > 0 && !ofRows.some((row) => splitStints.has(row.stint))) return out;

  for (const row of ofRows) {
    if (splitStints.has(row.stint)) continue; // covered by the split file
    const fromSeason =
      ofTotals !== undefined && ofTotals !== null && ofTotals.LF + ofTotals.CF + ofTotals.RF > 0
        ? mostPlayedOfSpot(ofTotals)
        : null;
    const spot = fromSeason ?? careerSpot ?? 'CF';
    out.push({ ...row, position: spot });
  }
  return out;
}

/** Career games by outfield spot, used for the pre-1954 fallback. */
export function accumulateOfGames(
  target: Map<string, OfGamesByField>,
  playerId: string,
  row: FieldingStint,
): void {
  if (!isOutfieldSpot(row.position)) return;
  let games = target.get(playerId);
  if (games === undefined) {
    games = emptyOfGames();
    target.set(playerId, games);
  }
  games[row.position] += row.games;
}
