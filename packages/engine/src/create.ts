import { resolveHouseRules } from '@cardball/shared';
import type { HouseRules, Position, SeasonStats } from '@cardball/shared';
import { pushEvent, roll } from './events.js';
import { GameError } from './errors.js';
import type { Rng } from './rng.js';
import type { EnginePlayer, GameEvent, GameSetup, GameState, PlayerSetup, Side, TeamSetup } from './types.js';
import { cardSeasons, rulesOf } from './queries.js';
import { startHalfInning } from './flow.js';

const FIELD_POSITIONS: readonly Position[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

/** The seasons listed on a card's back, under the rules in force. */
function cardSeasonsList(seasons: SeasonStats[], cardYear: number, rules: HouseRules): SeasonStats[] {
  const minYear = cardYear - rules.statWindowSeasons;
  return seasons.filter((s) => s.games > 0 && s.year < cardYear && s.year >= minYear);
}

/** A card may bat when at least one window season has the required AB. */
export function cardCanBat(player: PlayerSetup, rules: HouseRules): boolean {
  return cardSeasonsList(player.seasons, player.cardYear, rules).some((s) => s.ab >= rules.fullGameAb);
}

/** A card may pitch when at least one window season has any pitching appearance. */
export function cardCanPitch(player: PlayerSetup, rules: HouseRules): boolean {
  return cardSeasonsList(player.seasons, player.cardYear, rules).some(
    (s) => s.pitching !== null && (s.pitching.games > 0 || s.pitching.ipOuts > 0),
  );
}

export interface LineupData {
  lineup: string[];
  fieldPositions: Partial<Record<Position, string>>;
  startingPitcherId: string;
}

/** Validate a team's lineup the way the rules require. Throws GameError. */
export function validateTeamSetup(players: PlayerSetup[], lineupData: LineupData, teamName: string, rules: HouseRules): void {
  const byId = new Map(players.map((p) => [p.id, p]));

  if (players.length === 0) throw new GameError(`${teamName}: roster is empty`);
  for (const p of players) {
    if (cardSeasonsList(p.seasons, p.cardYear, rules).length === 0) {
      throw new GameError(`${teamName}: ${p.name}'s card has no seasons on the back`);
    }
  }

  const { lineup, fieldPositions, startingPitcherId } = lineupData;

  if (lineup.length !== 9) throw new GameError(`${teamName}: lineup must have 9 spots`);
  const lineupSet = new Set(lineup);
  if (lineupSet.size !== 9) throw new GameError(`${teamName}: lineup has duplicate players`);
  for (const id of lineup) {
    if (!byId.has(id)) throw new GameError(`${teamName}: lineup player ${id} is not on the roster`);
  }

  // Field positions: all eight covered, by eligible players, all in the lineup.
  for (const pos of FIELD_POSITIONS) {
    const id = fieldPositions[pos];
    if (!id) throw new GameError(`${teamName}: no player assigned to ${pos}`);
    const player = byId.get(id);
    if (!player) throw new GameError(`${teamName}: ${id} is not on the roster`);
    if (!lineupSet.has(id)) throw new GameError(`${teamName}: ${player.name} fields ${pos} but is not in the lineup`);
    if (!player.positions.includes(pos)) {
      throw new GameError(`${teamName}: ${player.name} is not eligible to field ${pos}`);
    }
    if (!cardCanBat(player, rules)) {
      throw new GameError(`${teamName}: ${player.name}'s card is not game-eligible (needs a ${rules.fullGameAb} AB season)`);
    }
  }
  const fielders = new Set(Object.values(fieldPositions));
  if (fielders.size !== FIELD_POSITIONS.length) {
    throw new GameError(`${teamName}: two positions are assigned to the same player`);
  }

  // The 9th hitter is the DH.
  const dh = lineup.filter((id) => !fielders.has(id));
  if (dh.length !== 1) throw new GameError(`${teamName}: exactly one DH is required`);

  // Starting pitcher: SP class, eligible, not in the batting lineup.
  const pitcher = byId.get(startingPitcherId);
  if (!pitcher) throw new GameError(`${teamName}: starting pitcher is not on the roster`);
  if (lineupSet.has(startingPitcherId)) {
    throw new GameError(`${teamName}: the pitcher cannot be in the batting lineup`);
  }
  if (pitcher.pitcherClass !== 'SP') {
    throw new GameError(`${teamName}: ${pitcher.name} is not a starting pitcher (needs a ${rules.starterIpThreshold}+ IP season)`);
  }
  if (!cardCanPitch(pitcher, rules)) {
    throw new GameError(`${teamName}: ${pitcher.name}'s card has no pitching stats`);
  }
}

function buildPlayer(
  setup: PlayerSetup,
  lineup: string[],
  fieldPositions: Partial<Record<Position, string>>,
  isStartingPitcher: boolean,
): EnginePlayer {
  const lineupSpot = lineup.indexOf(setup.id);
  let fieldPosition: Position | null = null;
  for (const [pos, id] of Object.entries(fieldPositions)) {
    if (id === setup.id) fieldPosition = pos as Position;
  }

  const active = lineupSpot >= 0 || isStartingPitcher;
  return {
    id: setup.id,
    cardModelId: setup.cardModelId,
    userCardId: setup.userCardId,
    name: setup.name,
    cardYear: setup.cardYear,
    teamLabel: setup.teamLabel,
    rarity: setup.rarity,
    positions: setup.positions,
    seasons: setup.seasons,
    fielding: setup.fielding,
    pitcherClass: setup.pitcherClass,
    status: active ? 'active' : 'bench',
    lineupSpot: lineupSpot >= 0 ? lineupSpot : null,
    fieldPosition,
    base: null,
    outsPitched: 0,
    pitchingRole: isStartingPitcher ? 'starter' : null,
    injured: false,
    exitDue: false,
    fatigueWaived: false,
  };
}

function buildTeam(setup: TeamSetup, side: Side, rules: HouseRules): GameState['home'] {
  validateTeamSetup(setup.players, setup, setup.name, rules);
  const players = setup.players.map((p) => buildPlayer(p, setup.lineup, setup.fieldPositions, p.id === setup.startingPitcherId));
  return {
    side,
    userId: setup.userId,
    isBot: setup.isBot ?? false,
    name: setup.name,
    players,
    score: 0,
    yearRoll: null,
    lineupCursor: 0,
    lineup: [...setup.lineup],
    activePitcherId: setup.startingPitcherId,
  };
}

/** Create a new game: validate both teams, roll for home/away, phase = lobby. */
export function createGame(setup: GameSetup, rng: Rng): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  // Snapshot the rules now; the game keeps these even if the commissioner
  // changes them mid-series.
  const rules = resolveHouseRules(setup.rules);

  if (!rules.regulationInningsOptions.includes(setup.regulationInnings)) {
    throw new GameError(`Games must be ${rules.regulationInningsOptions.join(', ')} innings`);
  }

  // Roll for home team, re-rolling ties.
  let rollA = rng.d6();
  let rollB = rng.d6();
  while (rollA === rollB) {
    rollA = rng.d6();
    rollB = rng.d6();
  }
  const homeIdx = rollA > rollB ? 0 : 1;
  const awayIdx = homeIdx === 0 ? 1 : 0;

  const [teamHome, teamAway] = [buildTeam(setup.teams[homeIdx]!, 'home', rules), buildTeam(setup.teams[awayIdx]!, 'away', rules)];

  const state: GameState = {
    id: setup.id,
    version: 0,
    config: { mode: setup.mode, regulationInnings: setup.regulationInnings, rules },
    phase: 'lobby',
    home: teamHome,
    away: teamAway,
    inning: 1,
    half: 'top',
    outs: 0,
    currentPa: null,
    pendingDecision: null,
    pendingPlay: null,
    firstPitchThrown: false,
    needsHalfStart: false,
    lastEventSeq: 0,
    winner: null,
    endedBy: null,
  };

  events.push(
    pushEvent(state, {
      kind: 'game-created',
      text: `${teamAway.name} and ${teamHome.name} meet for ${setup.regulationInnings} innings of Baseball Cardball.`,
      rolls: [
        roll(`${setup.teams[0]!.name} home-field roll`, 6, rollA, 0),
        roll(`${setup.teams[1]!.name} home-field roll`, 6, rollB, 0),
      ],
    }),
  );
  events.push(
    pushEvent(state, {
      kind: 'side-roll',
      text: `Dice decide it: ${teamHome.name} are the home team, ${teamAway.name} bat first.`,
      refs: { side: 'home' },
    }),
  );

  return { state, events };
}

/** Lobby action: rewrite a team's lineup wholesale. */
export function applySetLineup(state: GameState, side: Side, lineup: string[], fieldPositions: Partial<Record<Position, string>>, startingPitcherId: string): GameEvent[] {
  if (state.phase !== 'lobby') throw new GameError('Lineups are locked once the game starts — use substitutions');
  const team = side === 'home' ? state.home : state.away;

  const setups: PlayerSetup[] = team.players.map((p) => ({
    id: p.id,
    cardModelId: p.cardModelId,
    userCardId: p.userCardId,
    name: p.name,
    cardYear: p.cardYear,
    teamLabel: p.teamLabel,
    rarity: p.rarity,
    positions: p.positions,
    seasons: p.seasons,
    fielding: p.fielding,
    pitcherClass: p.pitcherClass,
  }));
  validateTeamSetup(setups, { lineup, fieldPositions, startingPitcherId }, team.name, rulesOf(state));

  team.players = setups.map((p) => buildPlayer(p, lineup, fieldPositions, p.id === startingPitcherId));
  team.lineup = [...lineup];
  team.activePitcherId = startingPitcherId;
  team.lineupCursor = 0;

  return [
    pushEvent(state, {
      kind: 'lineup',
      text: `${team.name} set their lineup and hand the ball to ${team.players.find((p) => p.id === startingPitcherId)?.name ?? 'their starter'}.`,
      refs: { side },
    }),
  ];
}

/** Lobby action: managers agree on a fielding rating. */
export function applySetFieldingOverride(state: GameState, side: Side, playerId: string, position: Position, rating: number): GameEvent[] {
  if (state.phase !== 'lobby') throw new GameError('Fielding ratings lock once the game starts');
  const team = side === 'home' ? state.home : state.away;
  const player = team.players.find((p) => p.id === playerId);
  if (!player) throw new GameError('Player is not on that team');
  if (!player.positions.includes(position)) {
    throw new GameError(`${player.name} is not eligible to field ${position}`);
  }
  player.fielding = { ...player.fielding, [position]: rating };
  return [
    pushEvent(state, {
      kind: 'lineup',
      text: `${team.name} agree ${player.name} fields ${position} at ${rating >= 0 ? '+' : ''}${rating}.`,
      refs: { playerId, side },
    }),
  ];
}

/** Start the game: year rolls, injuries, first plate appearance. */
export function startGame(state: GameState, rng: Rng): GameEvent[] {
  if (state.phase !== 'lobby') throw new GameError('The game has already started');

  const events: GameEvent[] = [
    pushEvent(state, {
      kind: 'game-start',
      text: `Play ball! ${state.away.name} at ${state.home.name}, ${state.config.regulationInnings} innings.`,
    }),
  ];

  state.phase = 'live';
  startHalfInning(state, events, rng);
  return events;
}
