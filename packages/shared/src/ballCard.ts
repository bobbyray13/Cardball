/**
 * The Baseball Cardball Ball Card, encoded.
 *
 * Four stat tables map a player's real season stats to dice-roll modifiers,
 * plus the contact-roll hit-type chart and the power tiers.
 *
 * Everything here is a faithful encoding of the physical Ball Card; the
 * values that were NOT on the attached spreadsheet (red/blue rolls, RBI
 * bonus, spray chart) live in `config.ts` as clearly-marked tunables.
 */

// ---------------------------------------------------------------------------
// HIT — batting average bands → pitch-roll modifier for the batter
// ---------------------------------------------------------------------------

export const HIT_BANDS: readonly { min: number; mod: number }[] = [
  { min: 0.325, mod: 3 },
  { min: 0.3, mod: 2 },
  { min: 0.28, mod: 1 },
  { min: 0.26, mod: 0 },
  { min: 0.24, mod: -1 },
  { min: 0.22, mod: -2 },
  { min: 0.0, mod: -3 },
];

/** AVG ≥ .325 → +3 … < .220 → −3 */
export function hitMod(avg: number | null): number {
  if (avg === null) return -3;
  for (const band of HIT_BANDS) {
    if (avg >= band.min) return band.mod;
  }
  return -3;
}

// ---------------------------------------------------------------------------
// PIT — ERA bands → pitch-roll modifier for the pitcher (lower is better)
// ---------------------------------------------------------------------------

export const PIT_BANDS: readonly { max: number; mod: number }[] = [
  { max: 2.0, mod: 3 },
  { max: 2.5, mod: 2 },
  { max: 3.0, mod: 1 },
  { max: 3.5, mod: 0 },
  { max: 4.0, mod: -1 },
  { max: 4.5, mod: -2 },
];

/** ERA ≤ 2.00 → +3 … > 4.50 → −3 */
export function pitMod(era: number | null): number {
  if (era === null) return -3;
  for (const band of PIT_BANDS) {
    if (era <= band.max) return band.mod;
  }
  return -3;
}

// ---------------------------------------------------------------------------
// SB — stolen base bands → runner roll modifier (steals, sends, DP factor)
// ---------------------------------------------------------------------------

export const SB_BANDS: readonly { min: number; mod: number }[] = [
  { min: 65, mod: 3 },
  { min: 50, mod: 2 },
  { min: 30, mod: 1 },
  { min: 15, mod: 0 },
  { min: 8, mod: -1 },
  { min: 5, mod: -2 },
  { min: 0, mod: -3 },
];

/** SB ≥ 65 → +3 … < 5 → −3 */
export function sbMod(sb: number): number {
  for (const band of SB_BANDS) {
    if (sb >= band.min) return band.mod;
  }
  return -3;
}

// ---------------------------------------------------------------------------
// Contact roll: the 20-sided hit-type chart
// ---------------------------------------------------------------------------

export type ContactType = 'pop-up' | 'grounder' | 'fly' | 'line-drive' | 'deep-fly' | 'home-run';

export interface ContactTypeInfo {
  type: ContactType;
  /** true when the ball is in the air (catchable by outfielders, tag-up eligible) */
  isAir: boolean;
}

const CONTACT_CHART: readonly ContactTypeInfo[] = [
  { type: 'pop-up', isAir: true }, // 1
  { type: 'grounder', isAir: false }, // 2
  { type: 'fly', isAir: true }, // 3
  { type: 'grounder', isAir: false }, // 4
  { type: 'fly', isAir: true }, // 5
  { type: 'grounder', isAir: false }, // 6
  { type: 'fly', isAir: true }, // 7
  { type: 'grounder', isAir: false }, // 8
  { type: 'fly', isAir: true }, // 9
  { type: 'grounder', isAir: false }, // 10
  { type: 'fly', isAir: true }, // 11
  { type: 'grounder', isAir: false }, // 12
  { type: 'fly', isAir: true }, // 13
  { type: 'grounder', isAir: false }, // 14
  { type: 'line-drive', isAir: true }, // 15
  { type: 'line-drive', isAir: true }, // 16
  { type: 'line-drive', isAir: true }, // 17
  { type: 'deep-fly', isAir: true }, // 18
  { type: 'deep-fly', isAir: true }, // 19
  { type: 'home-run', isAir: true }, // 20
];

export function contactInfo(roll: number): ContactTypeInfo {
  const info = CONTACT_CHART[roll - 1];
  if (!info) throw new Error(`Contact roll out of range: ${roll}`);
  return info;
}

// ---------------------------------------------------------------------------
// Power tiers — how hard the ball was hit gates extra-base hits.
// Within a tier, the best threshold the player's season clears wins
// (HR > 3B > 2B > single).
// ---------------------------------------------------------------------------

export interface PowerTier {
  /** inclusive d20 band for this tier */
  min: number;
  max: number;
  thresholds: { doubles: number; triples: number; homeRuns: number };
}

export const POWER_TIERS: readonly PowerTier[] = [
  { min: 10, max: 14, thresholds: { doubles: 35, triples: 10, homeRuns: 40 } },
  { min: 15, max: 17, thresholds: { doubles: 25, triples: 10, homeRuns: 30 } },
  { min: 18, max: 19, thresholds: { doubles: 20, triples: 5, homeRuns: 25 } },
];

export type HitKind = 'single' | 'double' | 'triple' | 'home-run';

export interface SeasonPowerStats {
  doubles: number;
  triples: number;
  homeRuns: number;
}

/**
 * Resolve what kind of hit an unfielded contact roll produces.
 * A natural 20 is an automatic home run; rolls below 10 are singles.
 */
export function resolveHitKind(contactRoll: number, season: SeasonPowerStats): HitKind {
  if (contactRoll === 20) return 'home-run';
  if (contactRoll < 10) return 'single';

  const tier = POWER_TIERS.find((t) => contactRoll >= t.min && contactRoll <= t.max);
  if (!tier) return 'single'; // defensive: should not happen for 10..19

  const { thresholds } = tier;
  if (season.homeRuns >= thresholds.homeRuns) return 'home-run';
  if (season.triples >= thresholds.triples) return 'triple';
  if (season.doubles >= thresholds.doubles) return 'double';
  return 'single';
}
