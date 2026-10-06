/**
 * Box-score lines: what one card did in one game, at the plate and on the
 * mound. The engine keeps them as the game is played; the server adds them up
 * across games for a card's history in a collection.
 *
 * Cardball has no errors, so every run a pitcher allows is earned.
 */

export interface BattingLine {
  pa: number;
  ab: number;
  r: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
  sb: number;
  cs: number;
  /** sacrifice flies: a plate appearance, not an at-bat */
  sf: number;
}

export interface PitchingLine {
  /** outs recorded while on the mound (IP × 3) */
  outs: number;
  /** batters faced */
  bf: number;
  h: number;
  /** runs charged to this pitcher; all of them earned */
  r: number;
  bb: number;
  k: number;
  hr: number;
}

export const emptyBattingLine = (): BattingLine => ({
  pa: 0,
  ab: 0,
  r: 0,
  h: 0,
  doubles: 0,
  triples: 0,
  hr: 0,
  rbi: 0,
  bb: 0,
  k: 0,
  sb: 0,
  cs: 0,
  sf: 0,
});

export const emptyPitchingLine = (): PitchingLine => ({ outs: 0, bf: 0, h: 0, r: 0, bb: 0, k: 0, hr: 0 });

export function addBattingLines(a: BattingLine, b: Partial<BattingLine>): BattingLine {
  const out = { ...a };
  for (const key of Object.keys(out) as (keyof BattingLine)[]) out[key] += b[key] ?? 0;
  return out;
}

export function addPitchingLines(a: PitchingLine, b: Partial<PitchingLine>): PitchingLine {
  const out = { ...a };
  for (const key of Object.keys(out) as (keyof PitchingLine)[]) out[key] += b[key] ?? 0;
  return out;
}

/** Innings pitched the way a box score prints them: 5 outs is "1.2". */
export function inningsLabel(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

/** ".333", or "—" before the first at-bat. */
export function battingAverage(line: Pick<BattingLine, 'h' | 'ab'>): string {
  if (line.ab === 0) return '—';
  return (line.h / line.ab).toFixed(3).replace(/^0/, '');
}

export function onBasePct(line: Pick<BattingLine, 'h' | 'bb' | 'ab' | 'sf'>): string {
  const denominator = line.ab + line.bb + line.sf;
  if (denominator === 0) return '—';
  return ((line.h + line.bb) / denominator).toFixed(3).replace(/^0/, '');
}

export function sluggingPct(line: Pick<BattingLine, 'h' | 'doubles' | 'triples' | 'hr' | 'ab'>): string {
  if (line.ab === 0) return '—';
  const bases = line.h + line.doubles + 2 * line.triples + 3 * line.hr;
  return (bases / line.ab).toFixed(3).replace(/^0/, '');
}

/** Earned run average over nine innings, or "—" with no outs recorded. */
export function earnedRunAverage(line: Pick<PitchingLine, 'r' | 'outs'>, inningsPerGame = 9): string {
  if (line.outs === 0) return line.r > 0 ? '∞' : '—';
  return ((line.r * inningsPerGame * 3) / line.outs).toFixed(2);
}

const counted = (n: number, label: string) => (n === 1 ? label : `${n} ${label}`);

/**
 * Today's line at the plate, the way a broadcaster reads it:
 * "2 for 3, 2 HR, 3 RBI, BB". Empty before the first plate appearance.
 */
export function formatBattingLine(line: BattingLine): string {
  if (line.pa === 0) return '';
  const extras: string[] = [];
  if (line.doubles) extras.push(counted(line.doubles, '2B'));
  if (line.triples) extras.push(counted(line.triples, '3B'));
  if (line.hr) extras.push(counted(line.hr, 'HR'));
  if (line.rbi) extras.push(counted(line.rbi, 'RBI'));
  if (line.r) extras.push(counted(line.r, 'R'));
  if (line.bb) extras.push(counted(line.bb, 'BB'));
  if (line.k) extras.push(counted(line.k, 'K'));
  if (line.sb) extras.push(counted(line.sb, 'SB'));
  if (line.cs) extras.push(counted(line.cs, 'CS'));
  if (line.sf) extras.push(counted(line.sf, 'SF'));
  return [`${line.h} for ${line.ab}`, ...extras].join(', ');
}

/** Today's line on the mound: "1.2 IP, 2 H, 2 ER, 1 BB, 3 K". */
export function formatPitchingLine(line: PitchingLine): string {
  if (line.bf === 0 && line.outs === 0) return '';
  const parts = [`${inningsLabel(line.outs)} IP`, `${line.h} H`, `${line.r} ER`, `${line.bb} BB`, `${line.k} K`];
  if (line.hr) parts.push(`${line.hr} HR`);
  return parts.join(', ');
}

/** A card's totals across finished games, with the games it came from. */
export interface CardCareer {
  userCardId: number;
  games: number;
  batting: BattingLine | null;
  pitching: PitchingLine | null;
  recent: CardGameLine[];
}

export interface CardGameLine {
  /** null once the game itself has been deleted */
  gameId: number | null;
  playedAt: string;
  /** the team this card played for, and who it faced */
  teamName: string;
  opponentName: string;
  won: boolean;
  batting: BattingLine | null;
  pitching: PitchingLine | null;
}
