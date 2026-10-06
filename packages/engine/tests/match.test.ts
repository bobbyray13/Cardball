import { describe, expect, it } from 'vitest';
import { MATCH_LIMITS, matchEraLabel, matchIsOpen, matchProblem, openMatch } from '@cardball/shared';
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
    const capped = match({ rarityCaps: { rare: 2, chase: 1 } });
    expect(matchIsOpen(capped)).toBe(false);
    expect(matchEraLabel(capped)).toBe('any era');
  });

  it('passes a roster that fits', () => {
    const roster = [card('Ken Griffey', 1997, 'chase'), card('Omar Vizquel', 1999, 'uncommon')];
    expect(matchProblem('Mariners', roster, match({ yearFrom: 1990, yearTo: 1999, rarityCaps: { rare: 1, chase: 1 } }))).toBeNull();
  });

  it('names the card that falls outside the era', () => {
    const roster = [card('Ken Griffey', 1997, 'chase'), card('Ichiro', 2004, 'rare')];
    const problem = matchProblem('Mariners', roster, match({ yearFrom: 1990, yearTo: 1999 }));
    expect(problem).toMatch(/Ichiro, a 2004 card/);
    expect(problem).toMatch(/1990–1999 only/);
  });

  it('counts each capped tier and says which one broke', () => {
    const roster = [card('A', 1997, 'chase'), card('B', 1998, 'chase'), card('C', 1999, 'rare'), card('D', 1999, 'common')];
    expect(matchProblem('Team', roster, match({ rarityCaps: { rare: 1, chase: 1 } }))).toMatch(/2 chase cards.*at most 1 chase card/);
    expect(matchProblem('Team', roster, match({ rarityCaps: { rare: 1, chase: 2 } }))).toBeNull();
    // Zero really means none of that tier.
    expect(matchProblem('Team', roster, match({ rarityCaps: { rare: 0, chase: 2 } }))).toMatch(/allows no rare cards/);
  });

  it('treats a cap at the limit as no cap at all', () => {
    const roster = [card('A', 1997, 'chase')];
    expect(matchProblem('Team', roster, match({ rarityCaps: { rare: MATCH_LIMITS.maxRare, chase: MATCH_LIMITS.maxChase } }))).toBeNull();
  });
});
