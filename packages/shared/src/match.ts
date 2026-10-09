/**
 * What a game's rosters have to look like.
 *
 * The house rules tune the dice; the match rules constrain the cards. A host
 * can say "this one is 1961–1992, and nobody brings more than one star card",
 * and the server checks both rosters against that before the first pitch — so
 * a game can't start with a roster that breaks its own rules.
 *
 * A match is snapshotted into the game like the house rules are, so a game in
 * progress keeps the rules it started under.
 */

import { z } from 'zod';
import type { DraftRarity } from './api.js';

export interface MatchRules {
  /** card years allowed on both rosters */
  yearFrom: number;
  yearTo: number;
  /** most rare, star, and mythic cards one roster may carry, or null for no limit */
  rarityCaps: { rare: number; star: number; mythic: number } | null;
  /**
   * Starters may field a position their card doesn't list, at the
   * out-of-position rating. Only tournaments set this: a drafted roster can't
   * go shopping for a center fielder. Not in matchRulesSchema on purpose.
   */
  outOfPosition?: boolean;
}

/** Match-rule limits, shared so the client and server agree on them. */
export const MATCH_LIMITS = {
  minYear: 1872,
  maxYear: 2100,
  /** widest era a match may span */
  maxSpan: 120,
  maxRare: 25,
  maxStar: 25,
  maxMythic: 25,
} as const;

export const matchRulesSchema = z.object({
  yearFrom: z.number().int().min(MATCH_LIMITS.minYear).max(MATCH_LIMITS.maxYear),
  yearTo: z.number().int().min(MATCH_LIMITS.minYear).max(MATCH_LIMITS.maxYear),
  rarityCaps: z
    .object({
      rare: z.number().int().min(0).max(MATCH_LIMITS.maxRare),
      star: z.number().int().min(0).max(MATCH_LIMITS.maxStar),
      mythic: z.number().int().min(0).max(MATCH_LIMITS.maxMythic),
    })
    .nullable()
    .default(null),
});

/**
 * Read a stored match, mapping the pre-Mythic cap shape onto today's tiers.
 * Games saved before Star and Mythic existed carry `{ rare, chase }`; their
 * chase cap becomes the star cap, and mythic was never capped for them.
 */
export function resolveMatchRules(raw: unknown): MatchRules {
  const value = (raw ?? {}) as Partial<MatchRules> & { rarityCaps?: Record<string, number> | null };
  const caps = value.rarityCaps;
  return {
    yearFrom: value.yearFrom ?? MATCH_LIMITS.minYear,
    yearTo: value.yearTo ?? MATCH_LIMITS.maxYear,
    rarityCaps: caps
      ? {
          rare: caps.rare ?? MATCH_LIMITS.maxRare,
          star: caps.star ?? caps.chase ?? MATCH_LIMITS.maxStar,
          mythic: caps.mythic ?? MATCH_LIMITS.maxMythic,
        }
      : null,
    ...(value.outOfPosition ? { outOfPosition: true } : {}),
  };
}

/** The most permissive match there is: any card, no caps. */
export function openMatch(): MatchRules {
  return { yearFrom: MATCH_LIMITS.minYear, yearTo: MATCH_LIMITS.maxYear, rarityCaps: null };
}

export function matchIsOpen(match: MatchRules): boolean {
  return match.yearFrom <= MATCH_LIMITS.minYear && match.yearTo >= MATCH_LIMITS.maxYear && match.rarityCaps === null;
}

/** "1961–1992", or "any era" when nothing is restricted. */
export function matchEraLabel(match: MatchRules): string {
  return match.yearFrom <= MATCH_LIMITS.minYear && match.yearTo >= MATCH_LIMITS.maxYear
    ? 'any era'
    : match.yearFrom === match.yearTo
      ? `${match.yearFrom}`
      : `${match.yearFrom}–${match.yearTo}`;
}

/** "3 rare / 2 star / 1 mythic each", or null when no tier is capped. */
export function matchCapsLabel(match: MatchRules): string | null {
  const caps = match.rarityCaps;
  if (!caps) return null;
  const parts: string[] = [];
  if (caps.rare < MATCH_LIMITS.maxRare) parts.push(`${caps.rare} rare`);
  if (caps.star < MATCH_LIMITS.maxStar) parts.push(`${caps.star} star`);
  if (caps.mythic < MATCH_LIMITS.maxMythic) parts.push(`${caps.mythic} mythic`);
  return parts.length > 0 ? `${parts.join(' / ')} each` : null;
}

/** A roster card, reduced to the three things a match rule looks at. */
export interface MatchCard {
  name: string;
  cardYear: number;
  rarity: DraftRarity;
}

/** A zero cap means "none of that tier", so keep it zero rather than widening it. */
function capText(n: number, tier: string): string {
  return n === 0 ? `no ${tier} cards` : `at most ${n} ${tier} card${n === 1 ? '' : 's'}`;
}

/**
 * The reason this roster is not legal for the match, or null when it is. Names
 * the offending card, so the manager knows exactly what to change.
 */
export function matchProblem(teamName: string, cards: MatchCard[], match: MatchRules): string | null {
  const outside = cards.find((c) => c.cardYear < match.yearFrom || c.cardYear > match.yearTo);
  if (outside) {
    return `${teamName} carries ${outside.name}, a ${outside.cardYear} card, and this match is ${matchEraLabel(match)} only`;
  }
  const caps = match.rarityCaps;
  if (!caps) return null;

  for (const tier of ['mythic', 'star', 'rare'] as const) {
    const cap = caps[tier];
    if (cap >= MATCH_LIMITS[tier === 'mythic' ? 'maxMythic' : tier === 'star' ? 'maxStar' : 'maxRare']) continue;
    const carried = cards.filter((c) => c.rarity === tier).length;
    if (carried > cap) return `${teamName} carries ${carried} ${tier} card${carried === 1 ? '' : 's'}, and this match allows ${capText(cap, tier)}`;
  }
  return null;
}
