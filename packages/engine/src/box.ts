import { emptyBattingLine, emptyPitchingLine } from '@cardball/shared';
import type { BattingLine, HitKind, PitchingLine } from '@cardball/shared';
import { getDefense, getOffense, getTeam } from './queries.js';
import type { EnginePlayer, GameState, Side, TeamBox } from './types.js';

/**
 * Box-score bookkeeping. The play functions call these at the moment a play
 * is decided, so the box is exact rather than reconstructed from the log.
 */

export function boxOf(state: GameState): Record<Side, TeamBox> {
  if (!state.box) state.box = { home: { batting: {}, pitching: {} }, away: { batting: {}, pitching: {} } };
  return state.box;
}

export function battingLine(state: GameState, side: Side, player: EnginePlayer): TeamBox['batting'][string] {
  const box = boxOf(state)[side];
  let line = box.batting[player.id];
  if (!line) {
    line = {
      ...emptyBattingLine(),
      spot: player.lineupSpot ?? 9,
      order: Object.keys(box.batting).length,
      position: player.fieldPosition ?? (player.lineupSpot !== null ? 'DH' : 'PR'),
    };
    box.batting[player.id] = line;
  }
  return line;
}

export function pitchingLine(state: GameState, side: Side, playerId: string): PitchingLine & { order: number } {
  const box = boxOf(state)[side];
  let line = box.pitching[playerId];
  if (!line) {
    line = { ...emptyPitchingLine(), order: Object.keys(box.pitching).length };
    box.pitching[playerId] = line;
  }
  return line;
}

/** Starting lineups and starting pitchers get a line before the first pitch. */
export function seedBox(state: GameState): void {
  for (const side of ['away', 'home'] as const) {
    const team = getTeam(state, side);
    for (const id of team.lineup) {
      const player = team.players.find((p) => p.id === id);
      if (player) battingLine(state, side, player);
    }
    if (team.activePitcherId) pitchingLine(state, side, team.activePitcherId);
  }
}

export type PaOutcome = 'strikeout' | 'walk' | 'out' | 'sac-fly' | HitKind;

/** The plate appearance in progress ended in `outcome`; charge batter and pitcher. */
export function creditPlateAppearance(state: GameState, outcome: PaOutcome): void {
  const pa = state.currentPa;
  if (!pa) return;
  const offense = getOffense(state);
  const defense = getDefense(state);
  const batter = offense.players.find((p) => p.id === pa.batterId);
  if (!batter) return;
  const bat = battingLine(state, offense.side, batter);
  const pit = pitchingLine(state, defense.side, pa.pitcherId);

  bat.pa += 1;
  pit.bf += 1;
  if (outcome !== 'walk' && outcome !== 'sac-fly') bat.ab += 1;
  // Whoever lets him on owns the run if he comes around.
  batter.chargedTo = pa.pitcherId;

  switch (outcome) {
    case 'strikeout':
      bat.k += 1;
      pit.k += 1;
      break;
    case 'walk':
      bat.bb += 1;
      pit.bb += 1;
      break;
    case 'sac-fly':
      bat.sf += 1;
      break;
    case 'out':
      break;
    default:
      bat.h += 1;
      pit.h += 1;
      if (outcome === 'double') bat.doubles += 1;
      if (outcome === 'triple') bat.triples += 1;
      if (outcome === 'home-run') {
        bat.hr += 1;
        pit.hr += 1;
      }
  }
}

/** A run scores: the runner's R, the batter's RBI, and the responsible pitcher's run. */
export function creditRun(state: GameState, runner: EnginePlayer): void {
  const offense = getOffense(state);
  const defense = getDefense(state);
  battingLine(state, offense.side, runner).r += 1;

  const pa = state.currentPa;
  const batter = pa ? offense.players.find((p) => p.id === pa.batterId) : undefined;
  if (batter) battingLine(state, offense.side, batter).rbi += 1;

  const pitcherId = runner.chargedTo ?? pa?.pitcherId ?? defense.activePitcherId;
  if (pitcherId) pitchingLine(state, defense.side, pitcherId).r += 1;
  runner.chargedTo = null;
}

export function creditOut(state: GameState): void {
  const defense = getDefense(state);
  if (defense.activePitcherId) pitchingLine(state, defense.side, defense.activePitcherId).outs += 1;
}

/** One player's lines so far today, without creating empty ones. */
export function lineFor(state: GameState, side: Side, playerId: string): { batting: BattingLine | null; pitching: PitchingLine | null } {
  const box = state.box?.[side];
  return { batting: box?.batting[playerId] ?? null, pitching: box?.pitching[playerId] ?? null };
}

/** Everyone who appeared, by collection card, for the card histories. */
export function collectionLines(state: GameState): { side: Side; userCardId: number; batting: BattingLine | null; pitching: PitchingLine | null }[] {
  const out: { side: Side; userCardId: number; batting: BattingLine | null; pitching: PitchingLine | null }[] = [];
  for (const side of ['away', 'home'] as const) {
    for (const player of getTeam(state, side).players) {
      if (player.userCardId === null) continue;
      const { batting, pitching } = lineFor(state, side, player.id);
      const batted = batting && batting.pa + batting.sb + batting.cs + batting.r > 0 ? strip(batting) : null;
      const pitched = pitching && pitching.bf + pitching.outs > 0 ? stripPitching(pitching) : null;
      if (batted || pitched) out.push({ side, userCardId: player.userCardId, batting: batted, pitching: pitched });
    }
  }
  return out;
}

function strip({ spot: _s, order: _o, position: _p, ...line }: BattingLine & { spot?: number; order?: number; position?: string }): BattingLine {
  return line;
}

function stripPitching({ order: _o, ...line }: PitchingLine & { order?: number }): PitchingLine {
  return line;
}

export function creditSteal(state: GameState, runner: EnginePlayer, safe: boolean): void {
  const line = battingLine(state, getOffense(state).side, runner);
  if (safe) line.sb += 1;
  else line.cs += 1;
}
