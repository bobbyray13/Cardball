/**
 * The mat's ball flight and beat sounds, pinned to the dice that drive them:
 * where the ball goes for each defender, hit, and steal, and what each
 * play-by-play beat sounds like. Pure geometry and mapping — no DOM needed.
 */
import { describe, expect, it } from 'vitest';
import { BASE_SPOTS, FENCE_R, FIELDER_SPOTS, HOME_PLATE, alongRay, distance, pointFromHome } from '../src/lib/fieldGeometry.js';
import { fieldedLeg, stealThrowLeg, throughLeg, unfieldedLeg } from '../src/lib/ballFlight.js';
import type { ContactRef } from '../src/lib/ballFlight.js';
import { soundFor } from '../src/lib/sound.js';

const contact = (over: Partial<ContactRef> = {}): ContactRef => ({
  seq: 10,
  directionRoll: 3,
  contactType: 'grounder',
  ...over,
});

describe('field geometry', () => {
  it('points straightaway center up the middle', () => {
    expect(pointFromHome(0, 20)).toEqual({ x: HOME_PLATE.x, y: HOME_PLATE.y - 20 });
  });

  it('sprays left and right of center by the sign of the angle', () => {
    expect(pointFromHome(-30, 30).x).toBeLessThan(HOME_PLATE.x);
    expect(pointFromHome(30, 30).x).toBeGreaterThan(HOME_PLATE.x);
  });

  it('scales a ray to a distance from home', () => {
    const leg = alongRay(FIELDER_SPOTS.CF!, 26);
    expect(distance(HOME_PLATE, leg)).toBeCloseTo(26, 5);
  });
});

describe('a ball hit to a fielder', () => {
  it('goes to the man making the play', () => {
    const leg = fieldedLeg(contact(), 11, 'SS');
    expect(leg.to).toEqual(FIELDER_SPOTS.SS);
    expect(leg.defenderPosition).toBe('SS');
    expect(leg.from).toEqual(HOME_PLATE);
    expect(leg.fades).toBe(false);
  });

  it('holds where a pop-up lands before it comes down', () => {
    const leg = fieldedLeg(contact({ contactType: 'pop-up' }), 11, '2B');
    // Three keyframes: travel to the spot, then the hang.
    expect(leg.times).toEqual([0, 0.55, 1]);
    expect(leg.seconds).toBeGreaterThan(0.9);
  });

  it('moves faster the harder it is hit', () => {
    const line = fieldedLeg(contact({ contactType: 'line-drive' }), 11, 'CF');
    const fly = fieldedLeg(contact({ contactType: 'fly' }), 11, 'CF');
    expect(line.seconds).toBeLessThan(fly.seconds);
  });

  it('falls back to a fair-territory spot when nobody is named', () => {
    const leg = fieldedLeg(contact(), 11, null);
    expect(distance(HOME_PLATE, leg.to)).toBeGreaterThan(10);
    expect(distance(HOME_PLATE, leg.to)).toBeLessThan(FENCE_R);
  });
});

describe('a hit through the fielder', () => {
  it('runs deeper the more bases it is worth', () => {
    const fielded = fieldedLeg(contact(), 11, '2B');
    const single = throughLeg(fielded, 12, 'single');
    const double = throughLeg(fielded, 12, 'double');
    const triple = throughLeg(fielded, 12, 'triple');
    expect(distance(HOME_PLATE, single.to)).toBeLessThan(distance(HOME_PLATE, double.to));
    expect(distance(HOME_PLATE, double.to)).toBeLessThan(distance(HOME_PLATE, triple.to));
    for (const leg of [single, double, triple]) {
      expect(leg.fades).toBe(false);
      expect(distance(HOME_PLATE, leg.to)).toBeLessThan(FENCE_R);
    }
  });

  it('keeps going out of the park on a home run', () => {
    const fielded = fieldedLeg(contact({ contactType: 'deep-fly' }), 11, 'CF');
    const leg = throughLeg(fielded, 12, 'home-run');
    expect(leg.fades).toBe(true);
    expect(distance(HOME_PLATE, leg.to)).toBeGreaterThan(FENCE_R);
  });

  it('starts where the fielder stood, so the flight continues seamlessly', () => {
    const fielded = fieldedLeg(contact(), 11, 'SS');
    const leg = throughLeg(fielded, 12, 'single');
    expect(leg.from).toEqual(fielded.to);
  });
});

describe('a hit nobody fields', () => {
  it('a natural 20 leaves the yard along its direction', () => {
    const leg = unfieldedLeg(contact({ contactType: 'home-run', directionRoll: 1 }), 12, 'home-run');
    expect(leg.fades).toBe(true);
    expect(distance(HOME_PLATE, leg.to)).toBeGreaterThan(FENCE_R);
    // Roll 1 is down the left-field line.
    expect(leg.to.x).toBeLessThan(HOME_PLATE.x);
  });

  it('a gap single lands in fair territory and stays', () => {
    const leg = unfieldedLeg(contact({ directionRoll: 6 }), 12, 'single');
    expect(leg.fades).toBe(false);
    expect(distance(HOME_PLATE, leg.to)).toBeGreaterThan(20);
    expect(distance(HOME_PLATE, leg.to)).toBeLessThan(FENCE_R);
    // Roll 6 is down the right-field line.
    expect(leg.to.x).toBeGreaterThan(HOME_PLATE.x);
  });
});

describe('a steal attempt', () => {
  it('throws to the bag under attack', () => {
    expect(stealThrowLeg(20, 2)?.to).toEqual(BASE_SPOTS[2]);
    expect(stealThrowLeg(20, 3)?.to).toEqual(BASE_SPOTS[3]);
  });

  it('has no throw to animate for home', () => {
    expect(stealThrowLeg(20, 4)).toBeNull();
  });
});

describe('what a beat sounds like', () => {
  it('is the bat on contact and leather on the out', () => {
    expect(soundFor({ kind: 'contact' })).toBe('bat');
    expect(soundFor({ kind: 'out' })).toBe('catch');
    expect(soundFor({ kind: 'dp-made' })).toBe('catch');
  });

  it('is the crowd for hits and runs, the organ only for a home run', () => {
    expect(soundFor({ kind: 'hit', refs: { hitKind: 'home-run' } })).toBe('home-run');
    expect(soundFor({ kind: 'hit', refs: { hitKind: 'single' } })).toBe('cheer');
    expect(soundFor({ kind: 'run' })).toBe('cheer');
  });

  it('is dice for anything with a roll in it', () => {
    expect(soundFor({ kind: 'pitch', rolls: [{ label: 'Pit', value: 4 }] })).toBe('dice');
    expect(soundFor({ kind: 'steal', rolls: [{ label: 'Run', value: 5 }] })).toBe('dice');
  });

  it('is silence for housekeeping beats', () => {
    expect(soundFor({ kind: 'lineup' })).toBeNull();
    expect(soundFor({ kind: 'half-end' })).toBeNull();
    expect(soundFor({ kind: 'sub' })).toBeNull();
  });
});
