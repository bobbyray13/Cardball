import { describe, expect, it } from 'vitest';
import { MATCH_LIMITS, matchCapsLabel, matchEraLabel, matchIsOpen, matchProblem, openMatch, resolveMatchRules } from '@cardball/shared';
import type { MatchCard, MatchRules } from '@cardball/shared';

const card = (name: string, cardYear: number, rarity: MatchCard['rarity']): MatchCard => ({ name, cardYear, rarity });

const match = (over: Partial<MatchRules> = {}): MatchRules => ({ ...openMatch(), ...over });

describe('match rules', () => {
  it('calls the widest rules open and prints anything else as an era', () => {
    expect(matchIsOpen(openMatch())).toBe(true);
    expect(matchEraLabel(openMatch())).toBe('any era');

    const nineties = match({ yearFrom: 1990, yearTo: 1999 });
    expect(matchIsOpen(nineties)).toBe(false);
    expect(matchEraLabel(nineties)).toBe('1990–1999');
    expect(matchEraLabel(match({ yearFrom: 1973, yearTo: 1973 }))).toBe('1973');

    // A cap alone makes a match restricted, even with every year allowed.
    const capped = match({ rarityCaps: { rare: 2, star: 1, mythic: 1 } });
    expect(matchIsOpen(capped)).toBe(false);
    expect(matchEraLabel(capped)).toBe('any era');
  });

  it('prints which tiers are capped', () => {
    expect(matchCapsLabel(match({ rarityCaps: { rare: 2, star: 1, mythic: 1 } }))).toBe('2 rare / 1 star / 1 mythic each');
    expect(matchCapsLabel(match({ rarityCaps: { rare: MATCH_LIMITS.maxRare, star: 1, mythic: MATCH_LIMITS.maxMythic } }))).toBe('1 star each');
    expect(matchCapsLabel(openMatch())).toBeNull();
  });

  it('passes a roster that fits', () => {
    const roster = [card('Ken Griffey', 1997, 'star'), card('Omar Vizquel', 1999, 'uncommon')];
    expect(
      matchProblem('Mariners', roster, match({ yearFrom: 1990, yearTo: 1999, rarityCaps: { rare: 1, star: 1, mythic: 0 } })),
    ).toBeNull();
  });

  it('names the card that falls outside the era', () => {
    const roster = [card('Ken Griffey', 1997, 'star'), card('Ichiro', 2004, 'rare')];
    const problem = matchProblem('Mariners', roster, match({ yearFrom: 1990, yearTo: 1999 }));
    expect(problem).toMatch(/Ichiro, a 2004 card/);
    expect(problem).toMatch(/1990–1999 only/);
  });

  it('counts each capped tier and says which one broke', () => {
    const roster = [card('A', 1997, 'star'), card('B', 1998, 'star'), card('C', 1999, 'rare'), card('D', 1999, 'common')];
    expect(matchProblem('Team', roster, match({ rarityCaps: { rare: 1, star: 1, mythic: 1 } }))).toMatch(
      /2 star cards.*at most 1 star card/,
    );
    expect(matchProblem('Team', roster, match({ rarityCaps: { rare: 1, star: 2, mythic: 1 } }))).toBeNull();
    // Zero really means none of that tier.
    expect(matchProblem('Team', roster, match({ rarityCaps: { rare: 0, star: 2, mythic: 1 } }))).toMatch(/allows no rare cards/);
  });

  it('treats a cap at the limit as no cap at all', () => {
    const roster = [card('A', 1997, 'mythic')];
    expect(
      matchProblem('Team', roster, match({ rarityCaps: { rare: MATCH_LIMITS.maxRare, star: MATCH_LIMITS.maxStar, mythic: MATCH_LIMITS.maxMythic } })),
    ).toBeNull();
  });

  it('reads matches saved before star and mythic, mapping chase to star', () => {
    const legacy = resolveMatchRules({ yearFrom: 1990, yearTo: 1999, rarityCaps: { rare: 2, chase: 1 } });
    expect(legacy.rarityCaps).toEqual({ rare: 2, star: 1, mythic: MATCH_LIMITS.maxMythic });

    const uncapped = resolveMatchRules({ yearFrom: 1990, yearTo: 1999, rarityCaps: { rare: 2 } });
    expect(uncapped.rarityCaps).toEqual({ rare: 2, star: MATCH_LIMITS.maxStar, mythic: MATCH_LIMITS.maxMythic });

    const open = resolveMatchRules(null);
    expect(open.rarityCaps).toBeNull();
  });
});
