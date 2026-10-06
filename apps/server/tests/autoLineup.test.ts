import { describe, expect, it } from 'vitest';
import type { CardSnapshot, Position } from '@cardball/shared';
import { autoLineup } from '../src/autoLineup.js';
import type { RosterCard } from '../src/autoLineup.js';

const FIELD: Position[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

/** A card that plays the given positions, with the given fielding ratings. */
function card(
  id: string,
  positions: Position[],
  opts: { avg?: number; fielding?: Partial<Record<Position, number>>; pitcherClass?: 'SP' | 'RP' | null; ab?: number } = {},
): RosterCard {
  const avg = opts.avg ?? 0.27;
  const ab = opts.ab ?? 500;
  const snapshot: CardSnapshot = {
    personId: Number(id.replace(/\D/g, '')) || 1,
    bbrefId: `test${id}`,
    name: `Player ${id}`,
    cardYear: 2004,
    teamLabel: 'TST',
    bats: 'R',
    throws: 'R',
    seasons: [1998, 1999, 2000, 2001, 2002, 2003].map((year) => ({
      year,
      teamLabel: 'TST',
      games: 150,
      ab,
      h: Math.round(avg * ab),
      avg,
      doubles: 20,
      triples: 2,
      homeRuns: 15,
      rbi: 70,
      sb: 10,
      pa: ab + 20,
      pitching: null,
      primaryPosition: null,
      positionsPlayed: [],
    })),
    positions,
    fielding: opts.fielding ?? {},
    pitcherClass: opts.pitcherClass ?? null,
    canBat: ab >= 100,
    canPitch: opts.pitcherClass != null,
    playable: true,
    ineligibleReason: null,
  };
  return { id, card: snapshot };
}

/** A full legal roster: one card per field spot, a DH, and a starter. */
function fullRoster(overrides: Partial<Record<Position, RosterCard>> = {}, extra: RosterCard[] = []): RosterCard[] {
  const roster = FIELD.map((pos, i) => overrides[pos] ?? card(`f${i}`, [pos]));
  return [...roster, ...extra, card('dh', ['1B'], { avg: 0.3 }), card('sp', [], { pitcherClass: 'SP' })];
}

describe('autoLineup', () => {
  it('fills all eight positions plus DH and a starter', () => {
    const result = autoLineup(fullRoster());
    expect('lineup' in result).toBe(true);
    if (!('lineup' in result)) return;
    expect(result.lineup.lineup).toHaveLength(9);
    expect(Object.keys(result.lineup.fieldPositions)).toHaveLength(8);
    expect(result.lineup.startingPitcherId).toBe('sp');
    expect(new Set(result.lineup.lineup).size).toBe(9);
  });

  it('does not spend a versatile fielder on a spot that leaves another empty', () => {
    // Sosa-like: the best CF on the roster, but the only right fielder too.
    // The greedy best-score-first pass would take him for CF and then fail on RF.
    const versatile = card('rf', ['RF', 'CF'], { fielding: { CF: 3, RF: 0 } });
    const onlyCf = card('cf', ['CF'], { fielding: { CF: -1 } });
    const result = autoLineup(fullRoster({ RF: versatile, CF: onlyCf }));

    expect('lineup' in result).toBe(true);
    if (!('lineup' in result)) return;
    expect(result.lineup.fieldPositions.RF).toBe('rf');
    expect(result.lineup.fieldPositions.CF).toBe('cf');
  });

  it('decides the scarcest position first', () => {
    // Only one card can catch, and he is also the only shortstop.
    const both = card('ss', ['C', 'SS'], { fielding: { SS: 3, C: -2 } });
    const pureC = card('c', ['C'], { fielding: { C: -3 } });
    const result = autoLineup(fullRoster({ C: pureC, SS: both }));

    expect('lineup' in result).toBe(true);
    if (!('lineup' in result)) return;
    expect(result.lineup.fieldPositions.C).toBe('c');
    expect(result.lineup.fieldPositions.SS).toBe('ss');
  });

  it('reports the position it cannot cover', () => {
    const roster = fullRoster().filter((r) => !r.card.positions.includes('RF'));
    const result = autoLineup(roster);
    expect(result).toEqual({ error: 'Nobody on the roster can play RF' });
  });

  it('needs a starting pitcher', () => {
    const roster = fullRoster().filter((r) => r.card.pitcherClass !== 'SP');
    expect(autoLineup(roster)).toEqual({ error: 'Need a starting pitcher (a 100+ IP season in his career)' });
  });

  it('prefers the best bat for the DH spot', () => {
    // A DH-only slugger: he cannot field anywhere, so he must be the DH.
    const slugger = card('slug', ['DH'], { avg: 0.34 });
    const result = autoLineup(fullRoster({}, [slugger]));
    expect('lineup' in result).toBe(true);
    if (!('lineup' in result)) return;
    expect(result.lineup.lineup).toContain('slug');
    expect(Object.values(result.lineup.fieldPositions)).not.toContain('slug');
  });
});
