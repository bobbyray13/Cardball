/**
 * The mat's coordinate system, in one place: a 100×75 viewBox (a 4:3 box, the
 * same aspect the container keeps, so the diamond stays square). The painted
 * field, every token, and the ball flight are all expressed in these units.
 * Because the viewBox is 75 tall but CSS `top` runs 0–100%, tokens convert y
 * on the way out (see `pctY`), or they would sit a quarter of the field too
 * high.
 */
export const VIEW_H = 75;
export const pctY = (y: number) => (y / VIEW_H) * 100;

/**
 * The diamond: a true square seen from above, home at the bottom. `BASE_GAP`
 * is the horizontal (and vertical) offset from one base to the next, so a
 * basepath is BASE_GAP·√2 long.
 */
export const BASE_GAP = 17;
export const HOME_PLATE = { x: 50, y: 64 };
export const BASE_SPOTS: Record<1 | 2 | 3, { x: number; y: number }> = {
  1: { x: HOME_PLATE.x + BASE_GAP, y: HOME_PLATE.y - BASE_GAP },
  2: { x: HOME_PLATE.x, y: HOME_PLATE.y - BASE_GAP * 2 },
  3: { x: HOME_PLATE.x - BASE_GAP, y: HOME_PLATE.y - BASE_GAP },
};
/** The rubber sits just short of the line between first and third, as on a real field. */
export const MOUND = { x: 50, y: HOME_PLATE.y - BASE_GAP * 0.95 };
/** The outfield fence, an arc around home plate. */
export const FENCE_R = 58;

/**
 * Where each defender plays. Every spot is in fair territory and clear of the
 * bags and basepaths, so a runner on base never hides under a fielder: the
 * corner men play behind their bags, the middle infielders back on the dirt
 * either side of second, the outfielders in their gaps.
 */
export const FIELDER_SPOTS: Record<string, { x: number; y: number }> = {
  C: { x: 50, y: 69.6 },
  '1B': { x: 70, y: 37.5 },
  '2B': { x: 61, y: 32 },
  SS: { x: 39, y: 32 },
  '3B': { x: 30, y: 37.5 },
  LF: { x: 24, y: 22 },
  CF: { x: 50, y: 12 },
  RF: { x: 76, y: 22 },
};

/** The batter's box on the third-base side of the plate. */
export const BATTER_BOX = { x: 44.5, y: 62.6 };

export type Point = { x: number; y: number };

export const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** The point `d` units from home along a ray at `angle` (0 = straightaway center, negative = left field). */
export const pointFromHome = (angleDegrees: number, d: number): Point => {
  const rad = (angleDegrees * Math.PI) / 180;
  return { x: HOME_PLATE.x + Math.sin(rad) * d, y: HOME_PLATE.y - Math.cos(rad) * d };
};

/** Scale the ray home→`target` to a given total distance from home. */
export const alongRay = (target: Point, d: number): Point => {
  const len = distance(HOME_PLATE, target);
  if (len === 0) return { ...target };
  const k = d / len;
  return { x: HOME_PLATE.x + (target.x - HOME_PLATE.x) * k, y: HOME_PLATE.y + (target.y - HOME_PLATE.y) * k };
};
