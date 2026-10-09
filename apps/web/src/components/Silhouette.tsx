import type { CardSnapshot } from '@cardball/shared';

/**
 * Player silhouettes.
 *
 * Every card wears original art drawn here: a ballplayer in his position's
 * pose, cut as a solid silhouette. Poses are built from round-capped strokes
 * for the limbs and filled paths for the torso, in the manner of stadium
 * pictograms, so they read at thumbnail size and hold up at card size.
 *
 * All poses share one 100×100 drawing box, face left (toward the plate), and
 * stand on a common ground line, so a row of them looks like one team.
 */

/** The six position groups a card can model, plus two pack-art extras. */
export type SilhouetteRole = 'SP' | 'RP' | 'C' | 'IF' | 'OF' | 'Util';
export type SilhouettePose = Exclude<SilhouetteRole, 'Util'> | 'Swing' | 'Stance';

/** One primitive shape of a pose. */
type Shape =
  | { k: 'c'; cx: number; cy: number; r: number }
  /** a round-capped stroke: limbs, bats, brims */
  | { k: 's'; d: string; w: number }
  /** a filled path: torso, caps */
  | { k: 'f'; d: string };

/** Limb widths shared by every pose, so figures feel like one family. */
const W = { arm: 6, forearm: 4.5, thigh: 8.5, shin: 5.5, foot: 4.5 } as const;

/** A cap with its brim poking forward; every pose but the catcher wears one. */
const cap = (hx: number, hy: number): Shape[] => [
  { k: 'f', d: `M${hx - 6.8} ${hy - 2.2} A6.8 6.8 0 0 1 ${hx + 6.8} ${hy - 2.2} Q${hx} ${hy - 7.4} ${hx - 6.8} ${hy - 2.2} Z` },
  { k: 's', d: `M${hx - 5.5} ${hy - 2.6} Q${hx - 9.5} ${hy - 2.4} ${hx - 12} ${hy - 0.4}`, w: 2.4 },
];

/** A batting helmet with a bill over the lead cheek. */
const helmet = (hx: number, hy: number): Shape[] => [
  { k: 'f', d: `M${hx - 6.9} ${hy - 1.9} A6.9 6.9 0 0 1 ${hx + 6.9} ${hy - 1.9} Q${hx} ${hy - 8} ${hx - 6.9} ${hy - 1.9} Z` },
  { k: 's', d: `M${hx - 5.8} ${hy - 2.4} Q${hx - 9.8} ${hy - 2.2} ${hx - 12.2} ${hy + 0.2}`, w: 2.6 },
  { k: 's', d: `M${hx - 4.6} ${hy + 0.5} Q${hx - 5.6} ${hy + 4} ${hx - 3.4} ${hy + 5.6}`, w: 3 },
];

/**
 * The poses. Feet sit near y = 93; heads near y = 13 (catcher, lower).
 * Facing left — the direction of the plate in every scene these appear in.
 */
export const POSE: Record<SilhouettePose, Shape[]> = {
  /**
   * Starting pitcher: the top of the windup. High leg kick toward the plate,
   * glove arm pointing at the target, ball hand back and up.
   */
  SP: [
    { k: 'c', cx: 34, cy: 13.5, r: 6.3 },
    ...cap(34, 13.5),
    { k: 'f', d: 'M25 21 Q34 17.4 43 21.4 L45.5 42.5 Q44.6 47.2 41 47.8 L31.5 46.8 Q27.6 45.8 26.6 42.4 Z' },
    // glove arm pointing at the plate
    { k: 's', d: 'M27.5 22.6 Q22.5 25 17.5 26.2', w: W.arm },
    { k: 's', d: 'M17.5 26.2 Q13 25.2 8.4 22.4', w: W.forearm },
    { k: 'c', cx: 6.4, cy: 21.2, r: 4.1 },
    // throwing arm back and high, ball at the fingertips
    { k: 's', d: 'M41.6 22.6 Q46.6 20.2 51.4 17.2', w: W.arm },
    { k: 's', d: 'M51.4 17.2 Q53.4 12 53.6 7', w: W.forearm },
    { k: 'c', cx: 54, cy: 5, r: 2.4 },
    // lifted front leg: knee high, shin hanging
    { k: 's', d: 'M35 47 Q29.5 43 25.5 39', w: W.thigh },
    { k: 's', d: 'M25.5 39 Q29.5 45.5 31.4 53.4', w: W.shin },
    { k: 's', d: 'M31.2 52.8 L28.4 59.6', w: W.foot },
    // plant leg under the rubber, slightly bent
    { k: 's', d: 'M40.2 47.6 Q43.4 58 46.2 68.4', w: W.thigh },
    { k: 's', d: 'M46.2 68.4 Q48.4 78 49.5 87.8', w: W.shin },
    { k: 's', d: 'M49 89.4 Q45.6 91.4 42.4 92.4', w: W.foot },
  ],

  /**
   * Reliever: firing from the stretch. Compact, arm whipped forward, back
   * toe dragging — a man coming in hot.
   */
  RP: [
    { k: 'c', cx: 30, cy: 13.5, r: 6.3 },
    ...cap(30, 13.5),
    { k: 'f', d: 'M21.6 21.6 Q30 17.6 38.4 22 L41.4 43 Q40.6 47.8 37 48.4 L28 47.6 Q24.4 46.6 23.4 43.4 Z' },
    // throwing arm extended, release in front
    { k: 's', d: 'M36.6 22 Q31 20.2 25.2 18.6', w: W.arm },
    { k: 's', d: 'M25.2 18.6 Q19 15.4 13.2 12.8', w: W.forearm },
    { k: 'c', cx: 11.6, cy: 11.6, r: 2.3 },
    // glove arm tucked into the ribs
    { k: 's', d: 'M23.6 22.4 Q20.2 26.4 17.2 30.8', w: W.arm },
    { k: 's', d: 'M17.2 30.8 Q21.4 34.4 25.6 35.6', w: W.forearm },
    { k: 'c', cx: 27.8, cy: 36.6, r: 4 },
    // front leg firm under the stride
    { k: 's', d: 'M31.2 48.6 Q25.4 55.8 19.6 63', w: W.thigh },
    { k: 's', d: 'M19.6 63 Q16.6 73.8 14.2 84.8', w: W.shin },
    { k: 's', d: 'M13.8 86.6 Q10.6 88.4 7.4 89.2', w: W.foot },
    // back leg trailing, toe dragging the dirt
    { k: 's', d: 'M37 49 Q42.4 57.6 47.4 66', w: W.thigh },
    { k: 's', d: 'M47.4 66 Q51.4 75.2 54.8 83.4', w: W.shin },
    { k: 's', d: 'M54.4 85.2 Q57.4 87.8 59.8 90.2', w: W.foot },
  ],

  /**
   * Catcher: the crouch. Mask on, glove out front giving the pitcher a
   * target, throwing hand tucked by the ear, knees wide.
   */
  C: [
    { k: 'c', cx: 36, cy: 26, r: 6.3 },
    // mask cage poking past the chin
    { k: 's', d: 'M30.6 26.6 Q27.4 27.8 24.6 29.4', w: 2.4 },
    // hunched torso, big rounded back
    { k: 'f', d: 'M30 32.4 Q36.4 29 42.2 33.4 Q48.6 40 47.6 49.6 Q46.8 57.4 40.4 59.4 L33.4 58.6 Q27.6 56.6 26.6 50.2 Z' },
    // glove arm out low
    { k: 's', d: 'M30.2 35.2 Q25.4 36.8 20.6 38.4', w: W.arm },
    { k: 's', d: 'M20.6 38.4 Q15.6 39.8 10.8 41', w: W.forearm },
    { k: 'c', cx: 7.4, cy: 41.6, r: 5 },
    // throwing hand by the ear, ready to come up firing
    { k: 's', d: 'M41.2 36.2 Q44.8 40 46.8 44.2', w: W.arm },
    { k: 's', d: 'M46.8 44.2 Q44.6 48.4 41.2 51.2', w: W.forearm },
    // deep squat, both knees forward
    { k: 's', d: 'M33.4 57 Q27.2 59.4 21.4 62', w: W.thigh },
    { k: 's', d: 'M21.4 62 Q19.2 73.4 17.8 84.6', w: W.shin },
    { k: 's', d: 'M17.4 86.4 Q14.2 88.2 11 89.2', w: W.foot },
    { k: 's', d: 'M39.2 58 Q33.6 62.2 28.2 66.6', w: 8 },
    { k: 's', d: 'M28.2 66.6 Q26.4 76.4 25.2 85.8', w: 5 },
    { k: 's', d: 'M24.8 87.6 Q21.6 89.2 18.4 90', w: 4 },
  ],

  /**
   * Infielder: down on a ground ball. Glove to the dirt, throwing hand
   * back and high, legs wide — about to come up throwing.
   */
  IF: [
    { k: 'c', cx: 37, cy: 17, r: 6.3 },
    ...cap(37, 17),
    { k: 'f', d: 'M29.6 24.6 Q37 20.6 44 26 L46.6 47 Q45.8 51.8 42 52.4 L34.6 51.4 Q30.8 50.4 30 46.8 Z' },
    // glove hand to the dirt
    { k: 's', d: 'M31.6 26.6 Q27.4 30.8 23.2 35', w: W.arm },
    { k: 's', d: 'M23.2 35 Q20 41 16.8 47', w: W.forearm },
    { k: 'c', cx: 14.4, cy: 49.6, r: 5.4 },
    // throwing arm back and up
    { k: 's', d: 'M43.6 27.2 Q48.4 30.2 52.4 33.2', w: W.arm },
    { k: 's', d: 'M52.4 33.2 Q55.6 27.8 58 22.6', w: W.forearm },
    // wide crouch: front leg loaded, back leg braced
    { k: 's', d: 'M39.6 52 Q34 57.8 28.6 63.6', w: W.thigh },
    { k: 's', d: 'M28.6 63.6 Q25.4 73.8 22.2 83.8', w: W.shin },
    { k: 's', d: 'M21.8 85.6 Q18.6 87.6 15.4 88.6', w: W.foot },
    { k: 's', d: 'M45.6 52.6 Q49.6 60.2 52.4 67.6', w: W.thigh },
    { k: 's', d: 'M52.4 67.6 Q53.8 77.8 54.4 87.4', w: W.shin },
    { k: 's', d: 'M54.2 89.2 Q51 91.4 47.8 92.4', w: W.foot },
  ],

  /**
   * Outfielder: hauling it in at a run, glove up over the shoulder, legs
   * mid-stride — the catch on the warning track.
   */
  OF: [
    { k: 'c', cx: 33, cy: 12, r: 6.3 },
    ...cap(33, 12),
    { k: 'f', d: 'M24.6 20.6 Q31.6 16.6 38.6 21.4 L41.6 44.4 Q40.8 49.2 37 49.8 L28.6 48.8 Q24.8 47.8 24 44 Z' },
    // glove arm up and back — over the shoulder
    { k: 's', d: 'M37.6 21.2 Q41.4 17.8 45 14.2', w: W.arm },
    { k: 's', d: 'M45 14.2 Q48.4 10.4 51.6 6.6', w: W.forearm },
    { k: 'c', cx: 53.8, cy: 4.4, r: 5 },
    { k: 'c', cx: 60.4, cy: 3.2, r: 2.2 },
    // off arm driving forward
    { k: 's', d: 'M28.6 22.4 Q24.4 26.2 20.2 30', w: W.arm },
    { k: 's', d: 'M20.2 30 Q16.6 32.6 13.2 35', w: W.forearm },
    // front knee driving up
    { k: 's', d: 'M35 49.4 Q29.4 52.8 24 57', w: W.thigh },
    { k: 's', d: 'M24 57 Q20.8 61 17.6 64.6', w: W.shin },
    { k: 's', d: 'M16.4 66 Q13 64.6 10.8 62.6', w: W.foot },
    // back leg extended behind, pushing off
    { k: 's', d: 'M39.6 49.8 Q45 56.8 50 63.8', w: W.thigh },
    { k: 's', d: 'M50 63.8 Q54.4 71.2 58.4 78.6', w: W.shin },
    { k: 's', d: 'M58.6 80.4 Q61.4 82.8 63.6 85.6', w: W.foot },
  ],

  /**
   * The designated hitter: full swing, follow-through. Bat wrapped up
   * behind, chest open, back heel pivoted — ball met, bat still moving.
   */
  Swing: [
    { k: 'c', cx: 40, cy: 12, r: 6.3 },
    ...helmet(40, 12),
    { k: 'f', d: 'M31 20.6 Q40 16.4 48.4 21.4 L50.2 42.6 Q49.4 47.6 45.6 48.2 L36.4 47.2 Q32.4 46.2 31.4 42.4 Z' },
    // top hand finishing high, bat up over the shoulder
    { k: 's', d: 'M34 22.2 Q29.4 20.4 25 18.6', w: W.arm },
    { k: 's', d: 'M25 18.6 Q21.2 14.8 17.6 10.4', w: W.forearm },
    { k: 'c', cx: 16, cy: 8.6, r: 3.3 },
    { k: 's', d: 'M16.6 8.2 Q24 4.4 31.4 1.6', w: 3.9 },
    // bottom hand released, arm finishing across the body
    { k: 's', d: 'M46.8 23 Q43 26.6 39 30', w: W.arm },
    { k: 's', d: 'M39 30 Q34.6 32 30.2 33.8', w: W.forearm },
    // legs: firm front side, back heel rolled over
    { k: 's', d: 'M37 48.4 Q31.4 56.6 26.2 64.8', w: W.thigh },
    { k: 's', d: 'M26.2 64.8 Q23.2 74.8 20.6 84.6', w: W.shin },
    { k: 's', d: 'M20.2 86.4 Q17 88.6 13.8 89.6', w: W.foot },
    { k: 's', d: 'M44.2 48.8 Q48.4 57.4 52.2 66', w: W.thigh },
    { k: 's', d: 'M52.2 66 Q54.2 75.8 54.8 85.6', w: W.shin },
    { k: 's', d: 'M54.6 87.4 Q58 86.2 61 84.6', w: W.foot },
  ],

  /**
   * A batter in the box: quiet stance, hands and bat cocked, knees bent,
   * weight ready to shift. The pack-art partner of the swing.
   */
  Stance: [
    { k: 'c', cx: 37, cy: 13, r: 6.3 },
    ...helmet(37, 13),
    { k: 'f', d: 'M29.4 21 Q37 17.6 44.4 21.8 L46.6 43.4 Q45.8 48.4 41.8 48.8 L33 47.8 Q29 46.8 28.2 43 Z' },
    // hands together, bat up at forty-five degrees
    { k: 's', d: 'M33 22.6 Q37 21.4 40.6 20.2', w: W.arm },
    { k: 's', d: 'M40.6 20.2 Q45.4 19 50 17.6', w: W.forearm },
    { k: 's', d: 'M35.6 24.6 Q40.8 23.2 45.8 21.8', w: W.forearm },
    { k: 'c', cx: 51.6, cy: 16.8, r: 3.4 },
    { k: 's', d: 'M51.8 16.4 Q60.6 9.6 69.4 3.2', w: 3.9 },
    // wide, bent-knee stance
    { k: 's', d: 'M33.6 48.2 Q27.2 57.4 21.2 66.6', w: W.thigh },
    { k: 's', d: 'M21.2 66.6 Q17.8 76.8 14.4 86.6', w: W.shin },
    { k: 's', d: 'M14 88.4 Q10.8 90 7.6 90.6', w: W.foot },
    { k: 's', d: 'M42 48.6 Q46.4 58.4 50.2 68.4', w: W.thigh },
    { k: 's', d: 'M50.2 68.4 Q52 78.2 52.6 87.8', w: W.shin },
    { k: 's', d: 'M52.4 89.6 Q49.2 91.6 46 92.4', w: W.foot },
  ],
};

/**
 * Which pose a card wears. Pitchers by class, then the first position the
 * card is actually eligible for (the back lists them most-played first), so
 * a utility man shows a bat and a shortstop shows a glove.
 */
export function silhouetteRole(card: Pick<CardSnapshot, 'pitcherClass' | 'positions'>): SilhouetteRole {
  if (card.pitcherClass === 'SP') return 'SP';
  if (card.pitcherClass === 'RP') return 'RP';
  const first = card.positions.find((p) => p !== 'DH' && p !== 'P');
  if (first === 'C') return 'C';
  if (first === 'LF' || first === 'CF' || first === 'RF') return 'OF';
  if (first) return 'IF';
  return 'Util';
}

/**
 * The shapes of one pose, rendered as a `<g>` ready to place anywhere.
 * `grow` fattens every shape by that many units, so drawing a pose twice —
 * grown in one color, then plain in another — gives it a clean rim.
 */
export function SilhouetteGroup({
  pose,
  fill,
  flip = false,
  grow = 0,
}: {
  pose: SilhouettePose;
  fill: string;
  flip?: boolean;
  grow?: number;
}) {
  return (
    <g fill={fill} stroke={fill} strokeLinejoin="round" transform={flip ? 'translate(100,0) scale(-1,1)' : undefined}>
      {POSE[pose].map((shape, i) => {
        if (shape.k === 'c') return <circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r + grow} stroke="none" />;
        if (shape.k === 's') return <path key={i} d={shape.d} strokeWidth={shape.w + grow * 2} strokeLinecap="round" fill="none" />;
        return <path key={i} d={shape.d} strokeWidth={grow * 2} stroke={grow > 0 ? fill : 'none'} />;
      })}
    </g>
  );
}

/** The short label a role wears on its badge. */
export const ROLE_LABEL: Record<SilhouetteRole, string> = {
  SP: 'SP',
  RP: 'RP',
  C: 'C',
  IF: 'IF',
  OF: 'OF',
  Util: 'UT',
};

/** The pose drawn for a role; the utility man is the bat. */
export const ROLE_POSE: Record<SilhouetteRole, SilhouettePose> = {
  SP: 'SP',
  RP: 'RP',
  C: 'C',
  IF: 'IF',
  OF: 'OF',
  Util: 'Swing',
};

/** A standalone figure: one pose, one color, in its own 100×100 svg. */
export function PlayerSilhouette({
  pose,
  className = '',
  title,
}: {
  pose: SilhouettePose;
  className?: string;
  title?: string;
}) {
  return (
    <svg viewBox="0 0 100 100" className={className} role={title ? 'img' : 'presentation'} aria-label={title}>
      <SilhouetteGroup pose={pose} fill="currentColor" />
    </svg>
  );
}
