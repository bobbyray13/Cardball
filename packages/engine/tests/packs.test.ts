import { describe, expect, it } from 'vitest';
import { PACK_THEMES, packTheme, packThemesForYears, themeForRound } from '@cardball/shared';
import type { CardRating } from '@cardball/shared';

/** A rating with only the numbers a theme looks at. */
function rating(best: Partial<CardRating['best']>): CardRating {
  return {
    rarity: 'common',
    headline: '',
    score: 0,
    best: { homeRuns: 0, avg: 0, stolenBases: 0, era: null, ...best },
  };
}

describe('pack themes', () => {
  it('offers every theme for a wide-open era', () => {
    expect(packThemesForYears(1901, 2020).map((t) => t.id)).toEqual(PACK_THEMES.map((t) => t.id));
  });

  it('keeps the era-gated themes out of an era they do not belong to', () => {
    const modern = packThemesForYears(1993, 2020).map((t) => t.id);
    expect(modern).not.toContain('deadball');
    expect(modern).toContain('liveball');

    const old = packThemesForYears(1901, 1919).map((t) => t.id);
    expect(old).toContain('deadball');
    expect(old).not.toContain('liveball');
  });

  it('reads a card against each wrapper label', () => {
    const slugger = rating({ homeRuns: 41 });
    const ace = rating({ era: 2.9 });
    const burner = rating({ stolenBases: 44 });
    const slap = rating({ avg: 0.331 });
    const scrub = rating({ homeRuns: 4, avg: 0.2, stolenBases: 2, era: 5.2 });

    expect(packTheme('mixed').matches(scrub)).toBe(true);
    expect(packTheme('sluggers').matches(slugger)).toBe(true);
    expect(packTheme('sluggers').matches(scrub)).toBe(false);
    expect(packTheme('aces').matches(ace)).toBe(true);
    expect(packTheme('aces').matches(rating({ era: null }))).toBe(false);
    expect(packTheme('speedsters').matches(burner)).toBe(true);
    expect(packTheme('contact').matches(slap)).toBe(true);
    expect(packTheme('liveball').matches(slugger)).toBe(true);
    expect(packTheme('liveball').matches(rating({ homeRuns: 29 }))).toBe(false);
    expect(packTheme('deadball').matches(burner)).toBe(true);
  });

  it('falls back to the mixed pack for a theme that is not there', () => {
    // @ts-expect-error deliberately unknown, as a stored config could be
    expect(packTheme('bogus').id).toBe('mixed');
  });

  it('rotates the wrapper around the seats and the rounds', () => {
    const themes = ['sluggers', 'aces'] as const;
    expect(themeForRound([...themes], 1, 0)).toBe('sluggers');
    expect(themeForRound([...themes], 1, 1)).toBe('aces');
    // Round two starts on the other foot, so the same seat sees a new wrapper.
    expect(themeForRound([...themes], 2, 0)).toBe('aces');
    expect(themeForRound([], 1, 0)).toBe('mixed');
  });
});
