/**
 * Themed packs.
 *
 * A pack is not a random handful any more: each one is a themed wrapper —
 * Sluggers, Aces, Speedsters — holding cards that fit its label. The theme
 * decides the pool, gives the wrapper its colors, and is printed on the pack
 * in the draft room.
 *
 * Two themes are tied to an era. Deadball is only offered when the draft's
 * card years reach back before 1931, and Live ball only once they reach 1920,
 * so an old-timers draft and a modern draft draw from different shelves.
 */

import type { DraftRarity } from './api.js';
import type { CardRating } from './rarity.js';

export type PackThemeId = 'mixed' | 'sluggers' | 'aces' | 'speedsters' | 'contact' | 'deadball' | 'liveball';

export interface PackTheme {
  id: PackThemeId;
  name: string;
  /** what the wrapper promises, in one line */
  blurb: string;
  /** printed on the wrapper, e.g. "25+ HR seasons" */
  hold: string;
  /** wrapper colors, drawn as a CSS gradient */
  colors: { from: string; to: string; ink: string };
  /** offered only when the draft's card years overlap this era */
  era?: { min?: number; max?: number };
  /** does a card belong in this pack? */
  matches: (rating: CardRating) => boolean;
}

export const PACK_THEMES: readonly PackTheme[] = [
  {
    id: 'mixed',
    name: 'Mixed pack',
    blurb: 'A little of everything, the way a real wax pack falls.',
    hold: 'any card',
    colors: { from: '#1a6344', to: '#0b2f21', ink: '#f6f2e6' },
    matches: () => true,
  },
  {
    id: 'sluggers',
    name: 'Sluggers',
    blurb: 'Big bats only. Somebody is going to hit one out of here.',
    hold: '25+ HR season',
    colors: { from: '#b3241f', to: '#5c120f', ink: '#f6f2e6' },
    matches: (r) => r.best.homeRuns >= 25,
  },
  {
    id: 'aces',
    name: 'Aces',
    blurb: 'Arms. Starters and relievers who kept the ERA down.',
    hold: '3.50 ERA or better',
    colors: { from: '#1b3a6b', to: '#0d1d36', ink: '#f6f2e6' },
    matches: (r) => r.best.era !== null && r.best.era <= 3.5,
  },
  {
    id: 'speedsters',
    name: 'Speedsters',
    blurb: 'Burners. They will steal on you and they will take the extra base.',
    hold: '30+ SB season',
    colors: { from: '#c96a3f', to: '#5c2d1a', ink: '#f6f2e6' },
    matches: (r) => r.best.stolenBases >= 30,
  },
  {
    id: 'contact',
    name: 'Batting champs',
    blurb: 'Singles hitters who never seem to make an out.',
    hold: '.300 AVG season',
    colors: { from: '#d8a83c', to: '#7a5c15', ink: '#1d1b18' },
    matches: (r) => r.best.avg >= 0.3,
  },
  {
    id: 'deadball',
    name: 'Deadball era',
    blurb: 'Small ball, spitballs, and stolen bases. The ball never leaves the park.',
    hold: 'pre-1931 · 25+ SB season',
    colors: { from: '#57514a', to: '#2b2823', ink: '#f6f2e6' },
    era: { max: 1930 },
    matches: (r) => r.best.stolenBases >= 25,
  },
  {
    id: 'liveball',
    name: 'Live ball',
    blurb: 'The lively ball years, when the home run became the point.',
    hold: '1920 and later · 30+ HR season',
    colors: { from: '#6b3fa0', to: '#2f1a4a', ink: '#f6f2e6' },
    era: { min: 1920 },
    matches: (r) => r.best.homeRuns >= 30,
  },
];

const THEME_BY_ID = new Map(PACK_THEMES.map((t) => [t.id, t]));

/** Every theme id, for validating what a host asked for. */
export const PACK_THEME_IDS: readonly PackThemeId[] = PACK_THEMES.map((t) => t.id);

export function packTheme(id: PackThemeId): PackTheme {
  return THEME_BY_ID.get(id) ?? PACK_THEMES[0]!;
}

/** Is this theme offered for a draft whose card years run `from`–`to`? */
export function themeFitsEra(theme: PackTheme, from: number, to: number): boolean {
  if (!theme.era) return true;
  if (theme.era.min !== undefined && to < theme.era.min) return false;
  if (theme.era.max !== undefined && from > theme.era.max) return false;
  return true;
}

/** The pack themes a draft with these card years may offer. */
export function packThemesForYears(from: number, to: number): PackTheme[] {
  return PACK_THEMES.filter((t) => themeFitsEra(t, from, to));
}

/** Rotate through the chosen themes so consecutive rounds don't repeat. */
export function themeForRound(themes: PackThemeId[], round: number, seat: number): PackThemeId {
  const list: PackThemeId[] = themes.length > 0 ? themes : ['mixed'];
  return list[(round - 1 + seat) % list.length]!;
}

// ---------------------------------------------------------------------------
// Collection packs
// ---------------------------------------------------------------------------

/**
 * Packs that live in a manager's inventory, separate from the draft room.
 * A starter pack comes with the account; the rest are earned — by winning
 * games and tournaments, finishing a historic collection, pulling off a feat
 * on the field, and winning a draft series.
 */
export type PackSource =
  | 'starter'
  | 'game-win'
  | 'tournament-win'
  | 'challenge'
  | 'draft-win'
  | 'draft-runner-up'
  | 'achievement'
  | 'grant';

/** How the cards inside a pack are dealt. */
export type PackShape = 'random' | 'lineup' | 'mound';

export const PACK_SOURCE_LABEL: Record<PackSource, string> = {
  starter: 'Starter pack',
  'game-win': 'Won a game',
  'tournament-win': 'Won a tournament',
  challenge: 'Collection complete',
  'draft-win': 'Won a draft game',
  'draft-runner-up': 'Draft consolation',
  achievement: 'Pulled off a feat',
  grant: 'Commissioner grant',
};

/** Cards in a collection pack, and the deal limits both sides agree on. */
export const PACK_LIMITS = { minSize: 3, maxSize: 12 } as const;

/** One card dealt out of a collection pack, kept so a torn-open pack still shows what it held. */
export interface DrawnCard {
  /** user_cards.id — the card as it sits in the collection */
  userCardId: number;
  personId: number;
  cardYear: number;
  name: string;
  teamLabel: string;
  rarity: DraftRarity;
  /** one-line scouting note, e.g. "41 HR, .328 AVG" */
  headline: string;
}

/** Rewards for finishing things, shared by the server and the shelf UI. */
export const REWARDS = {
  /** packs for winning a single game (any mode) */
  perGameWin: 1,
  /** packs for winning a tournament */
  perTournamentWin: 3,
  /** packs for completing a historic collection challenge */
  perChallenge: 2,
  /** bonus packs for feats pulled off during a game */
  perfectGame: 5,
  noHitter: 3,
  grandSlam: 1,
  walkoffHomer: 1,
  cycle: 5,
} as const;

/**
 * The wrappers a draft winner chooses between, in the room's own language:
 * a slugger pack, an aces pack, a speedster pack, or a batting-champs pack.
 */
export const WINNER_PACK_THEMES: readonly PackThemeId[] = ['sluggers', 'aces', 'speedsters', 'contact'];

/** The kind of achievement packs are awarded for, and what each pays. */
export const ACHIEVEMENT_PACKS = {
  'perfect-game': REWARDS.perfectGame,
  'no-hitter': REWARDS.noHitter,
  'grand-slam': REWARDS.grandSlam,
  'walkoff-hr': REWARDS.walkoffHomer,
  cycle: REWARDS.cycle,
} as const;

export type AchievementKind = keyof typeof ACHIEVEMENT_PACKS;
