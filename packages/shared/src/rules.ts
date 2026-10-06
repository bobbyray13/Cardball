/**
 * House rules: the one place every tunable number in Baseball Cardball lives.
 *
 * The commissioner edits these on the Commissioner page and they are stored in
 * the database. Each game snapshots a copy into its own state, so a game under
 * way is never re-tuned mid-inning, and two games can use different rules.
 *
 * Defaults are the values the game shipped with. Nothing here is invented at
 * call time — a card's printed dice modifier, the draft's rarity read, and the
 * engine's dice math all resolve through the same rule set.
 */

import { z } from 'zod';
import { HIT_BANDS, PIT_BANDS, POWER_TIERS, SB_BANDS } from './ballCard.js';
import type { MaxBand, MinBand, PowerTier } from './ballCard.js';
import { RBI_BONUS_BANDS, RUNNER_ADVANTAGE, RULES_CONFIG, SPRAY_CHART } from './config.js';
import { POSITIONS } from './positions.js';
import type { Position } from './positions.js';

/** One d6 spray-chart direction and the defenders it can send the ball to. */
export interface SprayDirection {
  roll: number;
  infield: Position[];
  outfield: Position[];
}

export interface HouseRules {
  // --- building a card ---
  /** seasons with an appearance that make up a card's stat window */
  statWindowSeasons: number;
  /** plate appearances a season needs to count as a full, healthy game */
  fullGameAb: number;
  /** outs on the mound (120 = 40 IP) a pitcher season needs to be healthy */
  pitcherInjuryIpOuts: number;
  /** innings in a season that make a pitcher a starter rather than a reliever */
  starterIpThreshold: number;
  /** games at a position to be eligible to field it */
  positionEligibilityGames: number;
  /** games at a position before a computed fielding rating replaces neutral */
  fieldingRatingMinGames: number;

  // --- the mound ---
  /** innings a pitcher may throw in one game, by role */
  ipCaps: { starter: number; reliever: number; closer: number };
  /** regulation innings that must be pitched by relievers */
  relieverOnlyInnings: number[];

  // --- at the plate ---
  /** consecutive tied pitch rolls that become a walk */
  walkBalls: number;
  /** a double play must sum to MORE than this on the d20 factors */
  dpTarget: number;
  /** baserunners re-roll all 1s when advancing */
  sendRerollOnes: boolean;
  /** catcher bonus when a runner tries for 3rd */
  stealThirdCatcherBonus: number;

  // --- game setup ---
  /** regulation inning choices offered when creating a game */
  regulationInningsOptions: number[];

  // --- the stat tables printed on the card ---
  hitBands: MinBand[];
  pitBands: MaxBand[];
  sbBands: MinBand[];
  rbiBands: MinBand[];
  /** contact rolls that help (+1) and hurt (−1) baserunners */
  runnerAdvantage: { red: number[]; blue: number[] };
  powerTiers: PowerTier[];
  sprayChart: SprayDirection[];
}

/** The rules as shipped. Deep-copied on read so callers cannot mutate them. */
export function defaultHouseRules(): HouseRules {
  return {
    statWindowSeasons: RULES_CONFIG.statWindowSeasons,
    fullGameAb: RULES_CONFIG.fullGameAb,
    pitcherInjuryIpOuts: RULES_CONFIG.pitcherInjuryIpOuts,
    starterIpThreshold: RULES_CONFIG.starterIpThreshold,
    positionEligibilityGames: RULES_CONFIG.positionEligibilityGames,
    fieldingRatingMinGames: RULES_CONFIG.fieldingRatingMinGames,
    ipCaps: { ...RULES_CONFIG.ipCaps },
    relieverOnlyInnings: [...RULES_CONFIG.relieverOnlyInnings],
    walkBalls: RULES_CONFIG.walkBalls,
    dpTarget: RULES_CONFIG.dpTarget,
    sendRerollOnes: RULES_CONFIG.sendRerollOnes,
    stealThirdCatcherBonus: RULES_CONFIG.stealThirdCatcherBonus,
    regulationInningsOptions: [...RULES_CONFIG.regulationInningsOptions],
    hitBands: HIT_BANDS.map((b) => ({ ...b })),
    pitBands: PIT_BANDS.map((b) => ({ ...b })),
    sbBands: SB_BANDS.map((b) => ({ ...b })),
    rbiBands: RBI_BONUS_BANDS.map((b) => ({ ...b })),
    runnerAdvantage: { red: [...RUNNER_ADVANTAGE.red], blue: [...RUNNER_ADVANTAGE.blue] },
    powerTiers: POWER_TIERS.map((t) => ({ ...t, thresholds: { ...t.thresholds } })),
    sprayChart: Object.entries(SPRAY_CHART).map(([roll, dir]) => ({
      roll: Number(roll),
      infield: [...dir.infield],
      outfield: [...dir.outfield],
    })),
  };
}

// ---------------------------------------------------------------------------
// Validation
//
// One schema serves the API route, the game snapshot, and the client, so a
// rule the commissioner saves is the rule the engine will run.
// ---------------------------------------------------------------------------

const positionSchema = z.enum(POSITIONS as unknown as [Position, ...Position[]]);
const positions = (max: number) => z.array(positionSchema).min(1).max(max);

const minBand = z.object({ min: z.number().min(-10000).max(10000), mod: z.number().int().min(-9).max(9) });
const maxBand = z.object({ max: z.number().min(-10000).max(10000), mod: z.number().int().min(-9).max(9) });

const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const houseRulesSchema = z.object({
  statWindowSeasons: int(1, 12),
  fullGameAb: int(0, 700),
  pitcherInjuryIpOuts: int(0, 1200),
  starterIpThreshold: int(0, 300),
  positionEligibilityGames: int(0, 162),
  fieldingRatingMinGames: int(0, 162),

  ipCaps: z.object({ starter: int(0, 12), reliever: int(0, 12), closer: int(0, 12) }),
  relieverOnlyInnings: z.array(int(1, 30)).max(12),

  walkBalls: int(1, 12),
  dpTarget: int(0, 60),
  sendRerollOnes: z.boolean(),
  stealThirdCatcherBonus: int(0, 6),

  regulationInningsOptions: z.array(int(1, 30)).min(1).max(6),

  hitBands: z.array(minBand).min(1).max(20),
  pitBands: z.array(maxBand).min(1).max(20),
  sbBands: z.array(minBand).min(1).max(20),
  rbiBands: z.array(minBand).min(1).max(20),
  runnerAdvantage: z.object({
    red: z.array(int(1, 20)).max(20),
    blue: z.array(int(1, 20)).max(20),
  }),
  powerTiers: z
    .array(
      z.object({
        min: int(1, 20),
        max: int(1, 20),
        thresholds: z.object({ doubles: int(0, 200), triples: int(0, 100), homeRuns: int(0, 100) }),
      }),
    )
    .min(1)
    .max(10),
  sprayChart: z
    .array(z.object({ roll: int(1, 6), infield: positions(5), outfield: positions(5) }))
    .min(1)
    .max(6),
});

/** Put a saved rule set in the order the lookup functions expect. */
function tidy(rules: HouseRules): HouseRules {
  const byMinDesc = (a: MinBand, b: MinBand) => b.min - a.min;
  const byMaxAsc = (a: MaxBand, b: MaxBand) => a.max - b.max;
  return {
    ...rules,
    relieverOnlyInnings: [...new Set(rules.relieverOnlyInnings)].sort((a, b) => a - b),
    regulationInningsOptions: [...new Set(rules.regulationInningsOptions)].sort((a, b) => a - b),
    hitBands: [...rules.hitBands].sort(byMinDesc),
    sbBands: [...rules.sbBands].sort(byMinDesc),
    rbiBands: [...rules.rbiBands].sort(byMinDesc),
    pitBands: [...rules.pitBands].sort(byMaxAsc),
    runnerAdvantage: {
      red: [...new Set(rules.runnerAdvantage.red)].sort((a, b) => a - b),
      blue: [...new Set(rules.runnerAdvantage.blue)].sort((a, b) => a - b),
    },
    powerTiers: [...rules.powerTiers].sort((a, b) => a.min - b.min),
    sprayChart: [...rules.sprayChart].sort((a, b) => a.roll - b.roll),
  };
}

/**
 * Validate a rule set from the client or the database.
 * Throws a ZodError with a readable message when a value is out of range.
 */
export function parseHouseRules(input: unknown): HouseRules {
  const parsed = houseRulesSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(first ? `${first.path.join('.') || 'rules'}: ${first.message}` : 'Invalid house rules');
  }
  return tidy(parsed.data as HouseRules);
}

/**
 * Fill in whatever is missing from the shipped defaults and validate.
 * Used when a saved rule set predates a new rule.
 */
export function resolveHouseRules(input?: unknown): HouseRules {
  const base = defaultHouseRules();
  if (input === undefined || input === null) return base;
  const merged = { ...base, ...(typeof input === 'object' && input !== null ? input : {}) };
  return parseHouseRules(merged);
}

// ---------------------------------------------------------------------------
// The rules in force right now
//
// The server loads these from the database at boot and on every save; the web
// client loads them from the API. Card faces and lineup picks read them so the
// numbers printed on a card match the numbers the dice will use. A game in
// progress reads its own snapshot instead, never this.
// ---------------------------------------------------------------------------

let active = defaultHouseRules();
const listeners = new Set<() => void>();

export function activeHouseRules(): HouseRules {
  return active;
}

export function setActiveHouseRules(next: HouseRules): void {
  active = next;
  for (const listener of listeners) listener();
}

export function subscribeHouseRules(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Convenience lookups, so callers do not reach into the shape by hand. */
export function sprayDirection(rules: HouseRules, roll: number): SprayDirection | undefined {
  return rules.sprayChart.find((d) => d.roll === roll);
}
