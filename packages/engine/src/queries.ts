import {
  fatiguePerInning,
  freshInningsFor,
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
import type { HouseRules, Position, SeasonStats } from '@cardball/shared';

/** The rules this game is playing under. */
export function rulesOf(state: GameState): HouseRules {
  return state.config.rules;
}

/** The spray-chart direction for a d6 roll under this game's rules. */
export function sprayDirection(state: GameState, direction: number): { infield: Position[]; outfield: Position[] } | undefined {
  return rulesOf(state).sprayChart.find((d) => d.roll === direction);
}

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
export function cardSeasons(player: EnginePlayer, rules: HouseRules): SeasonStats[] {
  const years = new Set(statWindowYears(player.cardYear, rules.statWindowSeasons));
  return player.seasons.filter((s) => years.has(s.year) && seasonAppeared(s)).sort((a, b) => a.year - b.year);
}

/** The season a roll-for-year points at before any skipping, most recent first. */
function naiveSeason(seasons: SeasonStats[], yearRoll: number): SeasonStats {
  const index = (seasons.length - 1 - ((yearRoll - 1) % seasons.length)) as number;
  return seasons[index]!;
}

/**
 * The season a player uses this inning, counting back `roll` seasons from the
 * most recent on the card, wrapping around (roll 5 with 3 listed years → 2nd).
 */
export function activeSeason(player: EnginePlayer, yearRoll: number | null, rules: HouseRules): SeasonStats {
  return resolveSeason(player, yearRoll, rules).season;
}

export interface SeasonResolution {
  season: SeasonStats;
  /** the year the roll originally landed on, when an unusable year was skipped */
  skippedYear: number | null;
}

/**
 * Resolve a roll-for-year to the season the dice actually read.
 *
 * A season that qualified as neither a healthy batting year nor a healthy
 * pitching year (a call-up cup of coffee, an injury year) is *skipped*: the
 * count moves on to the next-older season on the card, wrapping from the
 * oldest back to the most recent. A card whose every season is unusable keeps
 * the rolled season — the least bad answer, and the manager can bench him.
 *
 * The roll only ever lands on seasons the card actually lists, so a player
 * with three years of stats and a roll of 5 reads his 2nd season.
 */
export function resolveSeason(player: EnginePlayer, yearRoll: number | null, rules: HouseRules): SeasonResolution {
  const seasons = cardSeasons(player, rules);
  if (seasons.length === 0) throw new GameError(`${player.name} has no eligible seasons on this card`);
  if (yearRoll === null) throw new GameError('No roll-for-year yet this inning');

  const rolled = naiveSeason(seasons, yearRoll);
  if (!seasonIsInjuredYear(rolled, rules.fullGameAb, rules.pitcherInjuryIpOuts)) {
    return { season: rolled, skippedYear: null };
  }

  // Walk on to older seasons, wrapping, until one is usable.
  const index = seasons.indexOf(rolled);
  for (let step = 1; step < seasons.length; step++) {
    const candidate = seasons[(index - step + seasons.length) % seasons.length]!;
    if (!seasonIsInjuredYear(candidate, rules.fullGameAb, rules.pitcherInjuryIpOuts)) {
      return { season: candidate, skippedYear: rolled.year };
    }
  }

  // Every season on the card is unusable: play the rolled one as-is.
  return { season: rolled, skippedYear: null };
}

/** Team-level helper: this player's season for the current inning. */
export function seasonForPlayer(state: GameState, player: EnginePlayer): SeasonStats {
  const team = getPlayerTeam(state, player.id);
  return activeSeason(player, team.yearRoll, rulesOf(state));
}

// ---------------------------------------------------------------------------
// Modifiers
// ---------------------------------------------------------------------------

export function batterPitchMod(season: SeasonStats, rules: HouseRules): { mod: number; note: string } {
  const mod = hitMod(season.avg, rules.hitBands);
  return { mod, note: `${season.avg?.toFixed(3) ?? '—'} AVG → ${fmtMod(mod)}` };
}

export function pitcherPitchMod(season: SeasonStats, rules: HouseRules): { mod: number; note: string } {
  const mod = pitMod(season.pitching?.era ?? null, rules.pitBands);
  return { mod, note: `${season.pitching?.era?.toFixed(2) ?? '—'} ERA → ${fmtMod(mod)}` };
}

export function runnerSbMod(season: SeasonStats, rules: HouseRules): { mod: number; note: string } {
  const mod = sbMod(season.sb, rules.sbBands);
  return { mod, note: `${season.sb} SB → ${fmtMod(mod)}` };
}

/** Red/blue contact-roll advantage for baserunners (+1 / 0 / -1). */
export function contactAdvantage(contactRoll: number, rules: HouseRules): number {
  if (rules.runnerAdvantage.red.includes(contactRoll)) return 1;
  if (rules.runnerAdvantage.blue.includes(contactRoll)) return -1;
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
  return rbiBonus(season.rbi, rulesOf(state).rbiBands);
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
// Pitcher fatigue
// ---------------------------------------------------------------------------

/**
 * How tired the pitcher on the mound is right now, in pitch-roll points.
 *
 * A starter works `freshInningsFor(regulation)` full-strength innings (5 of a
 * 9-inning game, scaled down for 6- and 3-inning games); every inning past
 * that costs `fatiguePerInning`, counted as complete innings pitched — so a
 * +3 starter is a -1 walking into the 9th he started. Relievers pay the same
 * cost after every full inning they throw, from their first inning onward.
 * The modifier is per-game and disappears the moment the pitcher does.
 */
export function pitcherFatigue(state: GameState, player: EnginePlayer): number {
  if (!player.pitchingRole || player.outsPitched === 0) return 0;
  const inningsPitched = Math.floor(player.outsPitched / 3);
  const free = player.pitchingRole === 'starter' ? freshInningsFor(state.config.regulationInnings, rulesOf(state)) - 1 : 0;
  const fatiguedInnings = Math.max(0, inningsPitched - free);
  // Guard the sign of zero: "-0" would print as "fatigue −0" on the mat.
  return fatiguedInnings === 0 ? 0 : -fatiguedInnings * fatiguePerInning(rulesOf(state));
}

/** The pitcher's whole pitch-roll modifier: his season's rating plus fatigue. */
export function pitcherTotalMod(state: GameState, pitcher: EnginePlayer): { mod: number; note: string } {
  const season = seasonForPlayer(state, pitcher);
  const { mod, note } = pitcherPitchMod(season, rulesOf(state));
  const fatigue = pitcherFatigue(state, pitcher);
  if (fatigue === 0) return { mod, note };
  return {
    mod: mod + fatigue,
    note: `${note}, fatigue ${fmtMod(fatigue)}`,
  };
}

/** How the mat and the bullpen read fatigue aloud: "3 fatigued innings". */
export function fatigueInnings(state: GameState, player: EnginePlayer): number {
  return Math.max(0, -pitcherFatigue(state, player) / (fatiguePerInning(rulesOf(state)) || 1));
}

// ---------------------------------------------------------------------------
// Pitcher legality
// ---------------------------------------------------------------------------

/**
 * The final regulation inning (and extras) is closer territory: a reliever
 * taking the mound there is closing the game.
 */
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
  return { ok: true, reason: '' };
}

/** Bench pitchers who may legally enter right now. */
export function availablePitchers(state: GameState, side: Side): EnginePlayer[] {
  return getTeam(state, side).players.filter((p) => canEnterAsPitcher(state, p).ok);
}

/**
 * May the current pitcher stay on the mound? Fatigue never forces a change —
 * it only costs him on the pitch roll — so the only illegal pitcher is one
 * who is no longer in the game, or nobody at all.
 */
export function pitcherLegalOnMound(state: GameState, player: EnginePlayer): { ok: boolean; reason: string } {
  if (player.status !== 'active') return { ok: false, reason: 'has already been removed from the game' };
  if (!player.pitchingRole) return { ok: false, reason: 'is not the active pitcher' };
  return { ok: true, reason: '' };
}

/** Role a pitcher is assigned when entering now. */
export function roleForEnteringPitcher(state: GameState): 'starter' | 'reliever' | 'closer' {
  if (!state.firstPitchThrown) return 'starter';
  if (isCloserInning(state)) return 'closer';
  return 'reliever';
}
