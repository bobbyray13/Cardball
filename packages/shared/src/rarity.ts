/**
 * How rare a card is, read from the same stats the dice use.
 *
 * Every card gets a tier from its best season in the stat window, so a drafted
 * card, a scanned card, and a database card are all rated the same way. The
 * tier drives draft pack odds, rarity limits, and how the collection shows off.
 */

import type { DraftRarity } from './api.js';
import type { SeasonStats } from './stats.js';

export const RARITY_ORDER: readonly DraftRarity[] = ['common', 'uncommon', 'rare', 'star', 'mythic'];

export const RARITY_LABEL: Record<DraftRarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  star: 'Star',
  mythic: 'Mythic',
};

export function rarityRank(rarity: DraftRarity): number {
  return RARITY_ORDER.indexOf(rarity);
}

/**
 * What a card wears on its face. Common and uncommon cards stay plain; only
 * rare, star, and mythic cards get a printed label, so a binder shows off the
 * special ones at a glance.
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
  /**
   * The best season's headline numbers, so pack themes and the collection can
   * ask "is this a slugger?" without re-reading the card back.
   */
  best: BestSeason;
}

/** A card's best season in the stat window, by each measure. */
export interface BestSeason {
  homeRuns: number;
  avg: number;
  stolenBases: number;
  /** null when no season had enough innings to judge */
  era: number | null;
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
  // The cream of the crop: historic-peak seasons. Mythic is for the very best
  // a six-year window ever produced — 50 homers, a .350 average, a 2.00 ERA.
  if (bestHr >= 50 || bestAvg >= 0.35 || bestEra <= 2.0 || bestSb >= 75) rarity = 'mythic';
  else if (bestHr >= 40 || bestAvg >= 0.33 || bestEra <= 2.5 || bestSb >= 60) rarity = 'star';
  else if (bestHr >= 30 || bestAvg >= 0.31 || bestEra <= 3.0 || bestSb >= 40) rarity = 'rare';
  else if (bestHr >= 20 || bestAvg >= 0.29 || bestEra <= 3.75 || bestSb >= 25) rarity = 'uncommon';

  // Rough "how far past the bar" score, comparable across hitters and pitchers.
  const hitterScore = Math.max(bestHr / 40, bestAvg / 0.33, bestSb / 60);
  const pitcherScore = bestEra < 99 ? 2.5 / Math.max(bestEra, 0.5) : 0;
  const score = Math.round(Math.max(hitterScore, pitcherScore) * 1000) / 1000;

  return { rarity, headline, score, best: { homeRuns: bestHr, avg: bestAvg, stolenBases: bestSb, era: bestEra < 99 ? bestEra : null } };
}

// ---------------------------------------------------------------------------
// The back-of-card blurb: fun facts from the card's own seasons
// ---------------------------------------------------------------------------

/** IP printed the way a box score shows it (outs → innings). */
const ipLabel = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`;

/**
 * The tidbits printed on the back of a Star or Mythic card: unusual stats,
 * pulled from the card's own seasons, the way a real card carries a blurb.
 * Ordered best-first; callers print at most two.
 */
export function scoutingNotes(card: RatableCard): string[] {
  const notes: { rank: number; text: string }[] = [];
  const played = card.seasons.filter((s) => s.games > 0);

  const hrSeason = [...played].sort((a, b) => b.homeRuns - a.homeRuns)[0];
  if (hrSeason && hrSeason.homeRuns >= 30) {
    notes.push({ rank: hrSeason.homeRuns, text: `Pounded a career-best ${hrSeason.homeRuns} home runs in ${hrSeason.year}.` });
  }

  const avgSeason = [...played].filter((s) => s.ab >= 200 && s.avg !== null).sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0))[0];
  if (avgSeason && (avgSeason.avg ?? 0) >= 0.31) {
    notes.push({ rank: Math.round((avgSeason.avg ?? 0) * 1000), text: `Hit ${avgSeason.avg!.toFixed(3).replace(/^0/, '')} across ${avgSeason.ab} at-bats in ${avgSeason.year}.` });
  }

  const sbSeason = [...played].sort((a, b) => b.sb - a.sb)[0];
  if (sbSeason && sbSeason.sb >= 40) {
    notes.push({ rank: sbSeason.sb, text: `Swiped ${sbSeason.sb} bases in ${sbSeason.year}.` });
  }

  const eraSeason = [...played]
    .filter((s) => (s.pitching?.ipOuts ?? 0) >= 150 && s.pitching?.era !== null)
    .sort((a, b) => (a.pitching?.era ?? 99) - (b.pitching?.era ?? 99))[0];
  if (eraSeason && eraSeason.pitching) {
    notes.push({
      rank: Math.round(300 / eraSeason.pitching.era!),
      text: `Ran a ${eraSeason.pitching.era!.toFixed(2)} ERA over ${ipLabel(eraSeason.pitching.ipOuts)} innings in ${eraSeason.year}.`,
    });
  }

  const kSeason = [...played].sort((a, b) => (b.pitching?.so ?? 0) - (a.pitching?.so ?? 0))[0];
  if (kSeason && (kSeason.pitching?.so ?? 0) >= 250) {
    notes.push({ rank: kSeason.pitching!.so, text: `Struck out ${kSeason.pitching!.so} hitters in ${kSeason.year}.` });
  }

  return [...notes]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 2)
    .map((n) => n.text);
}
