/**
 * Season data: what the back of a card shows, and the derived values the
 * game engine needs from it. The import tool computes these once per
 * player-season; the server snapshots them into games; the engine only
 * reads plain objects.
 */

import type { Position } from './positions.js';

/** One player-season as it appears on a card back (multiple teams merged). */
export interface SeasonStats {
  year: number;
  /** e.g. "SEA" or "SEA/TOR" for a mid-season trade */
  teamLabel: string;

  // appearances
  games: number;

  // batting
  ab: number;
  h: number;
  /** H/AB, or null when AB = 0 */
  avg: number | null;
  doubles: number;
  triples: number;
  homeRuns: number;
  rbi: number;
  sb: number;
  pa: number;

  // pitching (null when the player never pitched that season)
  pitching: {
    games: number;
    /** innings pitched recorded in outs (10.1 IP → 31) */
    ipOuts: number;
    /** earned runs allowed * 27 / ipOuts, or null when ipOuts = 0 */
    era: number | null;
  } | null;

  /** primary position that season (most games), null for pure pitchers */
  primaryPosition: Position | null;

  /**
   * Positions played that season with games >= threshold, with the
   * computed fielding rating (-3..3) for each.
   */
  positionsPlayed: { position: Position; games: number; rating: number }[];
}

/** True when a season counts as "on the card" for roll-for-year counting. */
export function seasonAppeared(s: SeasonStats): boolean {
  return s.games > 0;
}

/** A batter season is healthy when it reached the required AB. */
export function batterSeasonHealthy(s: SeasonStats): boolean {
  return s.ab >= 100;
}

/** A pitcher season is healthy when it reached the required innings. */
export function pitcherSeasonHealthy(s: SeasonStats): boolean {
  return (s.pitching?.ipOuts ?? 0) >= 120;
}

/**
 * Landing on this season during roll-for-year injures the player:
 * neither a healthy batting year nor a healthy pitching year.
 */
export function seasonIsInjuredYear(s: SeasonStats): boolean {
  return !batterSeasonHealthy(s) && !pitcherSeasonHealthy(s);
}
