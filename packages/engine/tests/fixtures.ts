import type { Position, SeasonStats } from '@cardball/shared';
import { seededRng } from '../src/rng.js';
import type { PlayerSetup, TeamSetup } from '../src/types.js';

export const CARD_YEAR = 2010;
const FIELD: Position[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

export interface SeasonOverrides {
  avg?: number;
  ab?: number;
  sb?: number;
  doubles?: number;
  triples?: number;
  homeRuns?: number;
  rbi?: number;
  era?: number;
  ipOuts?: number;
}

export function season(year: number, o: SeasonOverrides = {}, pitcher = false): SeasonStats {
  const ab = o.ab ?? (pitcher ? 0 : 500);
  const avg = pitcher && !o.avg ? null : (o.avg ?? 0.26);
  return {
    year,
    teamLabel: 'TST',
    games: 100,
    ab,
    h: avg === null ? 0 : Math.round(avg * ab),
    avg,
    doubles: o.doubles ?? 0,
    triples: o.triples ?? 0,
    homeRuns: o.homeRuns ?? 0,
    rbi: o.rbi ?? 50,
    sb: o.sb ?? 15,
    pa: ab,
    pitching: pitcher ? { games: 30, ipOuts: o.ipOuts ?? 450, era: o.era ?? 3.25, so: 120, bb: 50, h: 140, w: 12, l: 8, sv: 0 } : null,
    primaryPosition: null,
    positionsPlayed: [],
  };
}

/** Six identical seasons on the back of a 2010 card. */
export function seasons(o: SeasonOverrides = {}, pitcher = false): SeasonStats[] {
  return [2004, 2005, 2006, 2007, 2008, 2009].map((y) => season(y, o, pitcher));
}

export function batter(id: string, positions: Position[], o: SeasonOverrides = {}, fielding = 0): PlayerSetup {
  return {
    id,
    cardModelId: 1,
    userCardId: null,
    name: `Batter ${id}`,
    cardYear: CARD_YEAR,
    teamLabel: 'TST',
    rarity: null,
    positions,
    seasons: seasons(o),
    fielding: Object.fromEntries(positions.map((p) => [p, fielding])),
    pitcherClass: null,
  };
}

export function pitcher(id: string, cls: 'SP' | 'RP', o: SeasonOverrides = {}): PlayerSetup {
  return {
    id,
    cardModelId: 1,
    userCardId: null,
    name: `Pitcher ${id}`,
    cardYear: CARD_YEAR,
    teamLabel: 'TST',
    rarity: null,
    positions: [],
    seasons: seasons({ ipOuts: cls === 'SP' ? 600 : 200, ...o }, true),
    fielding: {},
    pitcherClass: cls,
  };
}

/** A neutral team: every modifier 0, so scripted dice decide everything. */
export function neutralTeam(prefix: string, userId: number | null = 1): TeamSetup {
  const hitters = FIELD.map((pos, i) => batter(`${prefix}${i}`, [pos]));
  const dh = batter(`${prefix}dh`, ['1B']);
  const bench = [batter(`${prefix}b1`, ['C', '1B', '2B', '3B', 'SS']), batter(`${prefix}b2`, ['LF', 'CF', 'RF'])];
  const staff = [pitcher(`${prefix}sp`, 'SP'), pitcher(`${prefix}sp2`, 'SP'), pitcher(`${prefix}rp1`, 'RP'), pitcher(`${prefix}rp2`, 'RP'), pitcher(`${prefix}rp3`, 'RP'), pitcher(`${prefix}rp4`, 'RP')];
  return {
    userId,
    name: `Team ${prefix.toUpperCase()}`,
    players: [...hitters, dh, ...bench, ...staff],
    lineup: [...hitters.map((h) => h.id), dh.id],
    fieldPositions: Object.fromEntries(FIELD.map((pos, i) => [pos, `${prefix}${i}`])),
    startingPitcherId: `${prefix}sp`,
  };
}

/** A team with varied, sometimes injury-prone stats, for simulations. */
export function randomTeam(prefix: string, seed: number, isBot = true): TeamSetup {
  const rng = seededRng(seed);
  const pick = <T>(xs: T[]) => xs[rng.int(0, xs.length - 1)]!;
  const variedSeasons = (pitcherCard: boolean) =>
    [2004, 2005, 2006, 2007, 2008, 2009].map((y) =>
      season(
        y,
        {
          avg: pick([0.21, 0.235, 0.25, 0.27, 0.29, 0.31, 0.33]),
          ab: pitcherCard ? 0 : pick([40, 300, 450, 550, 600, 620]),
          sb: pick([0, 3, 6, 10, 20, 40, 70]),
          doubles: pick([10, 22, 30, 40]),
          triples: pick([0, 3, 6, 11]),
          homeRuns: pick([2, 15, 27, 33, 45]),
          rbi: pick([40, 80, 105, 125]),
          era: pick([1.9, 2.4, 2.9, 3.4, 3.9, 4.4, 5.2]),
          ipOuts: pitcherCard ? pick([60, 300, 600]) : 0,
        },
        pitcherCard,
      ),
    );
  const team = neutralTeam(prefix, null);
  team.isBot = isBot;
  team.players = team.players.map((p) => ({
    ...p,
    seasons: variedSeasons(p.pitcherClass !== null),
    fielding: Object.fromEntries(p.positions.map((pos) => [pos, rng.int(-3, 3)])),
  }));
  // Guarantee every hitter has a 100+ AB season so the lineup validates.
  for (const p of team.players) {
    if (p.pitcherClass === null) p.seasons[5] = { ...p.seasons[5]!, ab: 500, h: 130, avg: 0.26 };
  }
  return team;
}
