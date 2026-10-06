import {
  RUNNER_ADVANTAGE,
  RULES_CONFIG,
  hitMod,
  pitMod,
  sbMod,
  rbiBonus,
  seasonAppeared,
  seasonIsInjuredYear,
  statWindowYears,
} from '@cardball/shared';
import { GameError } from './errors.js';
import type { EnginePlayer, GameState, Side, TeamState } from './types.js';
import { otherSide } from './types.js';
import type { Position, SeasonStats } from '@cardball/shared';

// ---------------------------------------------------------------------------
// Teams & players
// ---------------------------------------------------------------------------

export function getTeam(state: GameState, side: Side): TeamState {
  return side === 'home' ? state.home : state.away;
}

export function getOffense(state: GameState): TeamState {
  return state.half === 'top' ? state.away : state.home;
}

export function getDefense(state: GameState): TeamState {
  return state.half === 'top' ? state.home : state.away;
}

export function getPlayer(state: GameState, playerId: string): EnginePlayer {
  for (const side of ['home', 'away'] as const) {
    const team = getTeam(state, side);
    const player = team.players.find((p) => p.id === playerId);
    if (player) return player;
  }
  throw new GameError(`Unknown player: ${playerId}`);
}

export function getPlayerTeam(state: GameState, playerId: string): TeamState {
  for (const side of ['home', 'away'] as const) {
    const team = getTeam(state, side);
    if (team.players.some((p) => p.id === playerId)) return team;
  }
  throw new GameError(`Unknown player: ${playerId}`);
}

export function playerById(state: GameState, playerId: string): EnginePlayer | undefined {
  for (const side of ['home', 'away'] as const) {
    const found = getTeam(state, side).players.find((p) => p.id === playerId);
    if (found) return found;
  }
  return undefined;
}

export function sideOfPlayer(state: GameState, playerId: string): Side {
  return getPlayerTeam(state, playerId).side;
}

export function activePitcher(state: GameState): EnginePlayer {
  const defense = getDefense(state);
  if (!defense.activePitcherId) throw new GameError('No pitcher on the mound');
  return getPlayer(state, defense.activePitcherId);
}

// ---------------------------------------------------------------------------
// Roll-for-year resolution
// ---------------------------------------------------------------------------

/** Seasons listed "on the back" of the card: appearances within the window years. */
export function cardSeasons(player: EnginePlayer): SeasonStats[] {
  const years = new Set(statWindowYears(player.cardYear));
  return player.seasons.filter((s) => years.has(s.year) && seasonAppeared(s)).sort((a, b) => a.year - b.year);
}

/**
 * The season a player uses this inning: count back `roll` seasons from the
 * most recent on the card, wrapping around (roll 5 with 3 listed years → 2nd).
 */
export function activeSeason(player: EnginePlayer, yearRoll: number | null): SeasonStats {
  const seasons = cardSeasons(player);
  if (seasons.length === 0) throw new GameError(`${player.name} has no eligible seasons on this card`);
  if (yearRoll === null) throw new GameError('No roll-for-year yet this inning');
  const index = (seasons.length - 1 - ((yearRoll - 1) % seasons.length)) as number;
  const season = seasons[index];
  if (!season) throw new GameError(`No season for roll ${yearRoll}`);
  return season;
}

/** Team-level helper: this player's season for the current inning. */
export function seasonForPlayer(state: GameState, player: EnginePlayer): SeasonStats {
  const team = getPlayerTeam(state, player.id);
  return activeSeason(player, team.yearRoll);
}

export function isSeasonInjured(player: EnginePlayer, yearRoll: number | null): boolean {
  const seasons = cardSeasons(player);
  if (seasons.length === 0) return false;
  // A card with a single healthy season can never roll an injured year.
  return seasonIsInjuredYear(activeSeason(player, yearRoll));
}

// ---------------------------------------------------------------------------
// Modifiers
// ---------------------------------------------------------------------------

export function batterPitchMod(season: SeasonStats): { mod: number; note: string } {
  const mod = hitMod(season.avg);
  return { mod, note: `${season.avg?.toFixed(3) ?? '—'} AVG → ${fmtMod(mod)}` };
}

export function pitcherPitchMod(season: SeasonStats): { mod: number; note: string } {
  const mod = pitMod(season.pitching?.era ?? null);
  return { mod, note: `${season.pitching?.era?.toFixed(2) ?? '—'} ERA → ${fmtMod(mod)}` };
}

export function runnerSbMod(season: SeasonStats): { mod: number; note: string } {
  const mod = sbMod(season.sb);
  return { mod, note: `${season.sb} SB → ${fmtMod(mod)}` };
}

/** Red/blue contact-roll advantage for baserunners (+1 / 0 / -1). */
export function contactAdvantage(contactRoll: number): number {
  if ((RUNNER_ADVANTAGE.red as readonly number[]).includes(contactRoll)) return 1;
  if ((RUNNER_ADVANTAGE.blue as readonly number[]).includes(contactRoll)) return -1;
  return 0;
}

export function fmtMod(mod: number): string {
  return mod > 0 ? `+${mod}` : `${mod}`;
}

/** RBI advantage with a runner on 2nd or 3rd. */
export function batterRbiBonus(state: GameState, batter: EnginePlayer, season: SeasonStats): number {
  const offense = getOffense(state);
  const risp = offense.players.some((p) => p.base === 2 || p.base === 3);
  if (!risp) return 0;
  return rbiBonus(season.rbi);
}

// ---------------------------------------------------------------------------
// Fielding & bases
// ---------------------------------------------------------------------------

export function fielderAt(state: GameState, side: Side, position: string): EnginePlayer | null {
  const team = getTeam(state, side);
  return team.players.find((p) => p.status === 'active' && p.fieldPosition === position) ?? null;
}

/** Fielding playing out of position (not on the card's eligible list). */
export const OUT_OF_POSITION_RATING = -3;

export function fieldingRating(player: EnginePlayer, position: string): number {
  const rated = player.fielding[position as keyof typeof player.fielding];
  if (rated !== undefined) return rated;
  return player.positions.includes(position as Position) ? 0 : OUT_OF_POSITION_RATING;
}

/** Runners on base for a team, ordered lead-first (3rd, then 2nd, then 1st). */
export function runnersOn(team: TeamState): EnginePlayer[] {
  return team.players
    .filter((p) => p.base !== null)
    .sort((a, b) => (b.base ?? 0) - (a.base ?? 0));
}

/** The lead runner (closest to home), or null. */
export function leadRunner(team: TeamState): EnginePlayer | null {
  const runners = runnersOn(team);
  return runners[0] ?? null;
}

export function batterDue(state: GameState): EnginePlayer {
  const offense = getOffense(state);
  const spot = offense.lineupCursor;
  const id = offense.lineup[spot];
  if (!id) throw new GameError(`Lineup spot ${spot + 1} is empty`);
  return getPlayer(state, id);
}

export function outsRemaining(state: GameState): number {
  return 3 - state.outs;
}

// ---------------------------------------------------------------------------
// Pitcher legality
// ---------------------------------------------------------------------------

export function pitcherCap(role: 'starter' | 'reliever' | 'closer'): number {
  return RULES_CONFIG.ipCaps[role] * 3; // in outs
}

/**
 * Reliever-only innings scale with game length: the 8th and 9th of a
 * 9-inning game, the 6th of a 6-inning game, none in a 3-inning game.
 * Extra innings are always reliever-only.
 */
export function isRelieverOnlyInning(state: GameState): boolean {
  const reg = state.config.regulationInnings;
  if (state.inning > reg) return true;
  const count = reg >= 9 ? RULES_CONFIG.relieverOnlyInnings.length : reg >= 6 ? 1 : 0;
  return state.inning > reg - count;
}

/** The final regulation inning (and extras) is closer territory. */
export function isCloserInning(state: GameState): boolean {
  return state.config.regulationInnings >= 6 && state.inning >= state.config.regulationInnings;
}

export function formatIp(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

/** Can this player take the mound now as a new pitcher? */
export function canEnterAsPitcher(state: GameState, player: EnginePlayer): { ok: boolean; reason: string } {
  if (player.status !== 'bench') return { ok: false, reason: 'is not available on the bench' };
  if (player.pitcherClass === null) return { ok: false, reason: 'never pitched in the majors' };
  if (isRelieverOnlyInning(state) && player.pitcherClass !== 'RP' && state.firstPitchThrown) {
    return { ok: false, reason: 'is a starter — this inning must be pitched by a reliever' };
  }
  return { ok: true, reason: '' };
}

/** Bench pitchers who may legally enter right now. */
export function availablePitchers(state: GameState, side: Side): EnginePlayer[] {
  return getTeam(state, side).players.filter((p) => canEnterAsPitcher(state, p).ok);
}

/**
 * May the current pitcher stay on the mound? Checks injury, caps, and the
 * reliever-only innings. When the bullpen is empty the manager can't be
 * forced to change, so the limit is waived (`fatigueWaived`).
 */
export function pitcherLegalOnMound(state: GameState, player: EnginePlayer): { ok: boolean; reason: string } {
  if (player.status !== 'active') return { ok: false, reason: 'has already been removed from the game' };
  if (!player.pitchingRole) return { ok: false, reason: 'is not the active pitcher' };
  if (player.fatigueWaived) return { ok: true, reason: '' };
  if (player.exitDue) return { ok: false, reason: 'is injured' };

  if (isRelieverOnlyInning(state) && player.pitcherClass !== 'RP' && player.pitchingRole === 'starter') {
    return { ok: false, reason: 'is a starter — this inning must be pitched by a reliever' };
  }

  const cap = pitcherCap(player.pitchingRole);
  if (player.outsPitched >= cap) {
    return { ok: false, reason: `has reached the ${player.pitchingRole} limit (${formatIp(player.outsPitched)} IP)` };
  }

  return { ok: true, reason: '' };
}

/** Role a pitcher is assigned when entering now. */
export function roleForEnteringPitcher(state: GameState): 'starter' | 'reliever' | 'closer' {
  if (!state.firstPitchThrown) return 'starter';
  if (isCloserInning(state)) return 'closer';
  return 'reliever';
}
