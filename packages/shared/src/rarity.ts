/**
 * How rare a card is, read from the same stats the dice use.
 *
 * Every card gets a tier from its best season in the stat window, so a drafted
 * card, a scanned card, and a database card are all rated the same way. The
 * tier drives draft pack odds, rarity limits, and how the collection shows off.
 */

import type { DraftRarity } from './api.js';
import type { SeasonStats } from './stats.js';

export const RARITY_ORDER: readonly DraftRarity[] = ['common', 'uncommon', 'rare', 'chase'];

export const RARITY_LABEL: Record<DraftRarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  chase: 'Chase',
};

export function rarityRank(rarity: DraftRarity): number {
  return RARITY_ORDER.indexOf(rarity);
}

/**
 * What a card wears on its face. Common and uncommon cards stay plain; only
 * rare and chase cards get a printed label, so a binder shows off the special
 * ones at a glance.
 */
export function faceLabel(rarity: DraftRarity): string | null {
  return rarityRank(rarity) >= rarityRank('rare') ? RARITY_LABEL[rarity] : null;
}

export interface RatableCard {
  seasons: SeasonStats[];
  canBat: boolean;
  canPitch: boolean;
}

export interface CardRating {
  rarity: DraftRarity;
  /** one-line scouting note, e.g. "38 HR · .270 AVG" or "2.44 ERA" */
  headline: string;
  /** a continuous score for sorting within a tier; higher is better */
  score: number;
}

/** 40 innings, so a reliever's sharp ten-inning cameo doesn't read as an ace. */
const ERA_MIN_IP_OUTS = 120;
const AVG_MIN_AB = 100;

export function rateCard(card: RatableCard): CardRating {
  const bestHr = Math.max(0, ...card.seasons.map((s) => s.homeRuns));
  const bestAvg = Math.max(0, ...card.seasons.filter((s) => s.ab >= AVG_MIN_AB).map((s) => s.avg ?? 0));
  const bestSb = Math.max(0, ...card.seasons.map((s) => s.sb));
  const bestEra = Math.min(
    99,
    ...card.seasons.filter((s) => (s.pitching?.ipOuts ?? 0) >= ERA_MIN_IP_OUTS).map((s) => s.pitching?.era ?? 99),
  );

  // Each number is that stat's best season in the window, so speed shows up
  // on the cards whose rarity it earned.
  const avgText = `.${String(Math.round(bestAvg * 1000)).padStart(3, '0')}`;
  const batting = [`${bestHr} HR`, `${avgText} AVG`, ...(bestSb >= 20 ? [`${bestSb} SB`] : [])].join(' · ');
  const pitching = bestEra < 99 ? `${bestEra.toFixed(2)} ERA` : 'no pitching';
  const headline = card.canPitch && !card.canBat ? pitching : card.canPitch ? `${batting} · ${pitching}` : batting;

  let rarity: DraftRarity = 'common';
  if (bestHr >= 40 || bestAvg >= 0.33 || bestEra <= 2.5 || bestSb >= 60) rarity = 'chase';
  else if (bestHr >= 30 || bestAvg >= 0.31 || bestEra <= 3.0 || bestSb >= 40) rarity = 'rare';
  else if (bestHr >= 20 || bestAvg >= 0.29 || bestEra <= 3.75 || bestSb >= 25) rarity = 'uncommon';

  // Rough "how far past the bar" score, comparable across hitters and pitchers.
  const hitterScore = Math.max(bestHr / 40, bestAvg / 0.33, bestSb / 60);
  const pitcherScore = bestEra < 99 ? 2.5 / Math.max(bestEra, 0.5) : 0;
  const score = Math.round(Math.max(hitterScore, pitcherScore) * 1000) / 1000;

  return { rarity, headline, score };
}
