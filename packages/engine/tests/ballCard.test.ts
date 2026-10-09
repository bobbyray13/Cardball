import { describe, expect, it } from 'vitest';
import { defaultHouseRules, hitMod, pitMod, resolveHitKind, sbMod } from '@cardball/shared';
import { activeSeason, resolveSeason } from '../src/queries.js';
import { batter, CARD_YEAR, season } from './fixtures.js';
import type { EnginePlayer } from '../src/types.js';

const RULES = defaultHouseRules();

describe('Ball Card modifier bands', () => {
  it('maps batting average to HIT', () => {
    expect(hitMod(0.33)).toBe(3);
    expect(hitMod(0.325)).toBe(3);
    expect(hitMod(0.3)).toBe(2);
    expect(hitMod(0.285)).toBe(1);
    expect(hitMod(0.26)).toBe(0);
    expect(hitMod(0.245)).toBe(-1);
    expect(hitMod(0.22)).toBe(-2);
    expect(hitMod(0.219)).toBe(-3);
    expect(hitMod(null)).toBe(-3);
  });

  it('maps ERA to PIT (lower is better)', () => {
    expect(pitMod(1.85)).toBe(3);
    expect(pitMod(2.5)).toBe(2);
    expect(pitMod(2.75)).toBe(1);
    expect(pitMod(3.5)).toBe(0);
    expect(pitMod(3.99)).toBe(-1);
    expect(pitMod(4.5)).toBe(-2);
    expect(pitMod(4.51)).toBe(-3);
  });

  it('maps stolen bases to SB', () => {
    expect(sbMod(70)).toBe(3);
    expect(sbMod(50)).toBe(2);
    expect(sbMod(30)).toBe(1);
    expect(sbMod(15)).toBe(0);
    expect(sbMod(8)).toBe(-1);
    expect(sbMod(5)).toBe(-2);
    expect(sbMod(4)).toBe(-3);
  });
});

describe('power tiers', () => {
  const slugger = { doubles: 40, triples: 2, homeRuns: 45 };
  const gapper = { doubles: 36, triples: 4, homeRuns: 10 };
  const speedster = { doubles: 22, triples: 11, homeRuns: 3 };
  const slap = { doubles: 12, triples: 1, homeRuns: 1 };

  it('natural 20 is always a home run', () => {
    expect(resolveHitKind(20, slap)).toBe('home-run');
  });
  it('below 10 is always a single', () => {
    expect(resolveHitKind(9, slugger)).toBe('single');
  });
  it('10-14 tier: 2B 35 / 3B 10 / HR 40', () => {
    expect(resolveHitKind(12, slugger)).toBe('home-run');
    expect(resolveHitKind(12, gapper)).toBe('double');
    expect(resolveHitKind(12, speedster)).toBe('triple');
    expect(resolveHitKind(12, slap)).toBe('single');
  });
  it('15-17 tier: 2B 25 / 3B 10 / HR 30', () => {
    expect(resolveHitKind(16, { doubles: 26, triples: 0, homeRuns: 29 })).toBe('double');
    expect(resolveHitKind(16, { doubles: 26, triples: 0, homeRuns: 30 })).toBe('home-run');
  });
  it('18-19 tier: 2B 20 / 3B 5 / HR 25', () => {
    expect(resolveHitKind(19, { doubles: 20, triples: 0, homeRuns: 0 })).toBe('double');
    expect(resolveHitKind(18, { doubles: 0, triples: 5, homeRuns: 24 })).toBe('triple');
    expect(resolveHitKind(18, { doubles: 0, triples: 0, homeRuns: 25 })).toBe('home-run');
  });
});

describe('roll for year', () => {
  /** A card whose seasons are listed years, optionally with per-year stat overrides. */
  const asPlayer = (
    seasonYears: (number | { year: number; ab?: number; ipOuts?: number })[],
    pitcherCard = false,
  ): EnginePlayer => {
    const setup = batter('x', ['1B']);
    return {
      ...setup,
      seasons: seasonYears.map((y) =>
        typeof y === 'number'
          ? season(y, {}, pitcherCard)
          : season(y.year, y.ab !== undefined ? { ab: y.ab } : { ipOuts: y.ipOuts }, pitcherCard && y.ab === undefined),
      ),
      status: 'active',
      lineupSpot: 0,
      fieldPosition: '1B',
      base: null,
      outsPitched: 0,
      pitchingRole: null,
    };
  };

  it('counts back from the most recent season', () => {
    const p = asPlayer([2004, 2005, 2006, 2007, 2008, 2009]);
    expect(activeSeason(p, 1, RULES).year).toBe(2009);
    expect(activeSeason(p, 6, RULES).year).toBe(2004);
  });

  it('wraps around when the card lists fewer than 6 seasons', () => {
    // Rules example: roll a 5 with 3 seasons listed → the 2nd season counting back.
    const p = asPlayer([2007, 2008, 2009]);
    expect(activeSeason(p, 5, RULES).year).toBe(2008);
    expect(activeSeason(p, 4, RULES).year).toBe(2009);
  });

  it('ignores seasons outside the card window', () => {
    const p = asPlayer([2001, 2008, CARD_YEAR, 2009]);
    expect(activeSeason(p, 1, RULES).year).toBe(2009);
    expect(activeSeason(p, 2, RULES).year).toBe(2008);
    expect(activeSeason(p, 3, RULES).year).toBe(2009);
  });

  it('honours a shorter stat window when the commissioner sets one', () => {
    const p = asPlayer([2004, 2005, 2006, 2007, 2008, 2009]);
    const shortWindow = { ...RULES, statWindowSeasons: 2 };
    expect(activeSeason(p, 1, shortWindow).year).toBe(2009);
    expect(activeSeason(p, 2, shortWindow).year).toBe(2008);
    expect(activeSeason(p, 3, shortWindow).year).toBe(2009);
  });

  it('skips an unusable season to the next-older one on the card', () => {
    // 2009 was a cup of coffee (20 AB); roll 1 lands on it, so the card reads 2008.
    const p = asPlayer([2007, 2008, { year: 2009, ab: 20 }]);
    const resolution = resolveSeason(p, 1, RULES);
    expect(resolution.season.year).toBe(2008);
    expect(resolution.skippedYear).toBe(2009);
  });

  it('wraps from the oldest unusable season back to the most recent', () => {
    // 2007 unusable: roll 3 lands on it and wraps to 2009.
    const p = asPlayer([{ year: 2007, ab: 20 }, 2008, 2009]);
    const resolution = resolveSeason(p, 3, RULES);
    expect(resolution.season.year).toBe(2009);
    expect(resolution.skippedYear).toBe(2007);
  });

  it('plays the rolled season as-is when every season is unusable', () => {
    const p = asPlayer([{ year: 2007, ab: 20 }, { year: 2008, ab: 20 }, { year: 2009, ab: 20 }]);
    const resolution = resolveSeason(p, 1, RULES);
    expect(resolution.season.year).toBe(2009);
    expect(resolution.skippedYear).toBeNull();
  });

  it('a healthy pitching year counts even when the bat was quiet', () => {
    // A pitcher card: roll 1 lands on 2009, where he did not bat but threw 60 IP.
    const p = asPlayer([2007, 2008, { year: 2009, ipOuts: 180 }], true);
    expect(resolveSeason(p, 1, RULES).skippedYear).toBeNull();
    expect(resolveSeason(p, 1, RULES).season.year).toBe(2009);
  });
});
