import type { ContactType, HitKind, Position } from '@cardball/shared';
import { BASE_SPOTS, FIELDER_SPOTS, HOME_PLATE, alongRay, distance, pointFromHome } from './fieldGeometry.js';
import type { Point } from './fieldGeometry.js';

/**
 * Where the ball goes on the mat, worked out from the play's dice — pure
 * geometry and timing, no React, so tests can pin it down. The field renders
 * one leg at a time: hit to the fielder (or its landing spot), then through
 * for a hit, fading only on a home run.
 */
export interface FlightLeg {
  /** unique per animation, so each leg mounts and plays once */
  key: string;
  from: Point;
  to: Point;
  /** position keyframe fractions: a repeated point is a hang, like a pop-up coming down */
  times: number[];
  seconds: number;
  /** home runs keep going out of the park */
  fades: boolean;
  /** the fielder making the play, whose token flashes */
  defenderPosition: Position | null;
  /** show a landing puff at `to` */
  puff: boolean;
}

/** What the contact die says about how the ball moves. */
export type ContactRef = { seq: number; directionRoll: number; contactType: ContactType };

/** One spray sector per direction roll: the angle a ball hit there leaves home at. */
const SECTOR_ANGLE: Record<number, number> = {
  1: -40, // down the left-field line
  2: -24,
  3: -8,
  4: 4,
  5: 18,
  6: 38, // down the right-field line
};

/** How long each contact type takes to reach the man fielding it. */
const TRAVEL: Record<ContactType, { seconds: number; times: number[] }> = {
  // A pop-up hangs in the air before it comes down: travel, then the hang.
  'pop-up': { seconds: 1.05, times: [0, 0.55, 1] },
  grounder: { seconds: 0.45, times: [0, 1] },
  'line-drive': { seconds: 0.3, times: [0, 1] },
  fly: { seconds: 0.95, times: [0, 1] },
  'deep-fly': { seconds: 1.1, times: [0, 1] },
  'home-run': { seconds: 1.1, times: [0, 1] },
};

/** Where a ball that nobody fields lands, by how many bases it is worth. */
const UNFIELDED_DEPTH: Record<HitKind, number> = {
  single: 32,
  double: 44,
  triple: 50,
  'home-run': 64,
};

const sectorAngle = (directionRoll: number) => SECTOR_ANGLE[directionRoll] ?? 0;

/** The ball is hit to the man making the play. */
export function fieldedLeg(contact: ContactRef, fieldingSeq: number, position: Position | null): FlightLeg {
  const travel = TRAVEL[contact.contactType];
  const spot = position ? FIELDER_SPOTS[position] : undefined;
  const to: Point = spot ?? pointFromHome(sectorAngle(contact.directionRoll), contact.contactType === 'pop-up' ? 18 : 34);
  return {
    key: `fielded-${fieldingSeq}`,
    from: HOME_PLATE,
    to,
    times: travel.times,
    seconds: travel.seconds,
    fades: false,
    defenderPosition: position,
    puff: false,
  };
}

/** The ball beats the man and keeps going — where it ends up by how many bases it is worth. */
export function throughLeg(prev: FlightLeg, hitSeq: number, hitKind: HitKind): FlightLeg {
  const depth = hitKind === 'home-run' ? 66 : Math.min(distance(HOME_PLATE, prev.to) + (hitKind === 'single' ? 8 : hitKind === 'double' ? 14 : 20), 54);
  const to = alongRay(prev.to, depth);
  return {
    key: `through-${hitSeq}`,
    from: prev.to,
    to,
    times: [0, 1],
    seconds: 0.4,
    fades: hitKind === 'home-run',
    defenderPosition: null,
    puff: true,
  };
}

/** A hit nobody had a play on (natural 20, or a defensive gap): straight to its landing spot. */
export function unfieldedLeg(contact: ContactRef, hitSeq: number, hitKind: HitKind): FlightLeg {
  return {
    key: `unfielded-${hitSeq}`,
    from: HOME_PLATE,
    to: pointFromHome(sectorAngle(contact.directionRoll), UNFIELDED_DEPTH[hitKind]),
    times: [0, 1],
    seconds: hitKind === 'home-run' ? 1.1 : 0.75,
    fades: hitKind === 'home-run',
    defenderPosition: null,
    puff: true,
  };
}

/** The catcher's throw on a steal attempt: fast, to the bag under attack. */
export function stealThrowLeg(stealSeq: number, base: number): FlightLeg | null {
  const target = base === 2 ? BASE_SPOTS[2] : base === 3 ? BASE_SPOTS[3] : base === 1 ? BASE_SPOTS[1] : null;
  if (!target) return null;
  return {
    key: `steal-${stealSeq}`,
    from: FIELDER_SPOTS.C!,
    to: target,
    times: [0, 1],
    seconds: 0.32,
    fades: true,
    defenderPosition: 'C',
    puff: false,
  };
}
