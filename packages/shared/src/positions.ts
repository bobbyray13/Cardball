/**
 * Field positions in Baseball Cardball.
 * `P` is a fielding position; pitchers do not bat in the lineup unless placed there.
 */
export type Position = 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH' | 'P';

export const POSITIONS: readonly Position[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'P'];

export const INFIELD_POSITIONS: readonly Position[] = ['C', '1B', '2B', '3B', 'SS', 'P'];
export const OUTFIELD_POSITIONS: readonly Position[] = ['LF', 'CF', 'RF'];

export function isPosition(value: string): value is Position {
  return (POSITIONS as readonly string[]).includes(value);
}
