import { creditRun } from './box.js';
import { pushEvent } from './events.js';
import type { Rng } from './rng.js';
import type { EnginePlayer, GameEvent, GameState, Side, TeamState } from './types.js';
import {
  activeSeason,
  availablePitchers,
  getDefense,
  getOffense,
  isCloserInning,
  isSeasonInjured,
  pitcherLegalOnMound,
  rulesOf,
} from './queries.js';

/**
 * Half-inning / plate-appearance flow. Everything here mutates the state
 * clone produced by applyAction and pushes events. Functions that would need
 * dice to continue (a new half-inning's year roll) set `needsHalfStart`
 * instead, and applyAction finishes the job with its rng.
 */

/** Bench players who can bat/run (have at least one eligible position). */
export function benchHitters(team: TeamState): EnginePlayer[] {
  return team.players.filter((p) => p.status === 'bench' && p.positions.length > 0);
}

/** Begin a half-inning: roll-for-year at the top of each inning, pitcher checks, first PA. */
export function startHalfInning(state: GameState, events: GameEvent[], rng: Rng): void {
  state.needsHalfStart = false;
  const defense = getDefense(state);

  if (state.half === 'top') {
    for (const team of [state.away, state.home]) {
      const value = rng.d6();
      team.yearRoll = value;
      events.push(
        pushEvent(state, {
          kind: 'year-roll',
          text: `${team.name} roll for year: ${value}.`,
          rolls: [{ label: `${team.name} year roll`, sides: 6, value, modifier: 0, total: value }],
          refs: { side: team.side },
        }),
      );
    }

    for (const team of [state.away, state.home]) {
      for (const player of team.players) {
        if (player.status !== 'active' || player.injured) continue;
        const rules = rulesOf(state);
        if (isSeasonInjured(player, team.yearRoll, rules)) {
          player.injured = true;
          const year = activeSeason(player, team.yearRoll, rules).year;
          events.push(
            pushEvent(state, {
              kind: 'injury',
              text: `${player.name} (${team.name}) lands on his ${year} season — injured! He leaves after his next plate appearance.`,
              refs: { playerId: player.id, side: team.side },
            }),
          );
        }
      }
    }
  }

  const pitcher = defense.players.find((p) => p.id === defense.activePitcherId);
  if (pitcher && pitcher.pitchingRole === 'reliever' && isCloserInning(state)) {
    pitcher.pitchingRole = 'closer';
    events.push(
      pushEvent(state, {
        kind: 'info',
        text: `${pitcher.name} stays in to close — 1 inning max from here.`,
        refs: { playerId: pitcher.id, side: defense.side },
      }),
    );
  }

  openPlateAppearance(state, events);
}

/**
 * Make sure the defense has a legal pitcher. Returns false (and raises a
 * pitcher-change decision) when the manager must make a move.
 */
function ensurePitcher(state: GameState, events: GameEvent[]): boolean {
  const defense = getDefense(state);
  const pitcher = defense.players.find((p) => p.id === defense.activePitcherId);
  const reason = pitcher ? pitcherLegalOnMound(state, pitcher) : { ok: false, reason: 'is missing' };
  if (reason.ok) return true;

  if (availablePitchers(state, defense.side).length === 0 && pitcher && pitcher.status === 'active') {
    pitcher.fatigueWaived = true;
    events.push(
      pushEvent(state, {
        kind: 'info',
        text: `${defense.name} have nobody left in the bullpen — ${pitcher.name} has to keep pitching.`,
        refs: { playerId: pitcher.id, side: defense.side },
      }),
    );
    return true;
  }

  state.pendingDecision = {
    kind: 'pitcher-change',
    side: defense.side,
    prompt: pitcher
      ? `${pitcher.name} ${reason.reason} — choose a new pitcher.`
      : `${defense.name} need a pitcher — choose one.`,
  };
  return false;
}

/**
 * Opens the next plate appearance, raising forced decisions first.
 * Does nothing when paused on a decision, mid-play, or between halves.
 */
export function openPlateAppearance(state: GameState, events: GameEvent[]): void {
  if (state.phase !== 'live' || state.pendingDecision || state.pendingPlay || state.needsHalfStart) return;
  if (state.currentPa) return;

  const offense = getOffense(state);
  const dueId = offense.lineup[offense.lineupCursor] ?? null;
  if (!dueId) {
    // Vacated spot with nobody left on the bench: automatic out.
    state.outs += 1;
    events.push(
      pushEvent(state, {
        kind: 'out',
        text: `Nobody left to bat in the ${offense.lineupCursor + 1} spot for ${offense.name} — automatic out.`,
        refs: { side: offense.side },
      }),
    );
    if (state.outs >= 3) {
      endHalfInning(state, events);
      return;
    }
    advanceLineupCursor(state);
    openPlateAppearance(state, events);
    return;
  }

  if (!ensurePitcher(state, events)) return;

  const defense = getDefense(state);
  state.currentPa = { batterId: dueId, pitcherId: defense.activePitcherId!, balls: 0 };
}

/**
 * Bookkeeping after a plate appearance resolves: injured exits, lineup
 * advance, then open the next PA (or end the half).
 */
export function finishPlateAppearance(state: GameState, events: GameEvent[]): void {
  const pa = state.currentPa;
  state.currentPa = null;
  const offense = getOffense(state);

  if (pa) {
    const batter = offense.players.find((p) => p.id === pa.batterId);
    if (batter && batter.injured && batter.status === 'active') {
      handleInjuredBatter(state, offense, batter, events);
    }
    const pitcher = getDefense(state).players.find((p) => p.id === pa.pitcherId);
    if (pitcher && pitcher.injured && pitcher.status === 'active') pitcher.exitDue = true;
  }

  if (state.outs >= 3) {
    endHalfInning(state, events);
    return;
  }

  advanceLineupCursor(state);
  openPlateAppearance(state, events);
}

function handleInjuredBatter(state: GameState, offense: TeamState, batter: EnginePlayer, events: GameEvent[]): void {
  const hasBench = benchHitters(offense).length > 0;
  const onBase = batter.base !== null && state.outs < 3;

  if (onBase && hasBench) {
    state.pendingDecision = {
      kind: 'pinch-runner',
      side: offense.side,
      playerId: batter.id,
      prompt: `${batter.name} reached base but is injured — choose a pinch-runner.`,
    };
    return;
  }

  // He's done either way: off the bases, out of the game.
  batter.base = null;
  batter.status = 'out';
  events.push(
    pushEvent(state, {
      kind: 'injury',
      text: `${batter.name} is injured and leaves the game.`,
      refs: { playerId: batter.id, side: offense.side },
    }),
  );

  if (hasBench) {
    state.pendingDecision = {
      kind: 'lineup-fill',
      side: offense.side,
      playerId: batter.id,
      prompt: `Replace ${batter.name} in the lineup${batter.fieldPosition ? ` (${batter.fieldPosition})` : ''}.`,
    };
  } else {
    const spot = offense.lineup.indexOf(batter.id);
    if (spot >= 0) offense.lineup[spot] = null;
    batter.fieldPosition = null;
  }
}

export function advanceLineupCursor(state: GameState): void {
  const offense = getOffense(state);
  offense.lineupCursor = (offense.lineupCursor + 1) % 9;
}

/** End the current half-inning: clear bases, check game end, flip sides. */
export function endHalfInning(state: GameState, events: GameEvent[], batterCompleted = true): void {
  const offense = getOffense(state);
  for (const player of offense.players) player.base = null;
  // A batter whose PA was cut short (caught stealing for out 3) leads off next time.
  if (batterCompleted) offense.lineupCursor = (offense.lineupCursor + 1) % 9;
  state.outs = 0;
  state.currentPa = null;
  state.pendingPlay = null;
  if (state.pendingDecision?.kind === 'pinch-runner') state.pendingDecision = null;

  events.push(
    pushEvent(state, {
      kind: 'half-end',
      text: `End of the ${state.half} of the ${ordinal(state.inning)}. ${state.away.name} ${state.away.score}, ${state.home.name} ${state.home.score}.`,
    }),
  );

  const winner = winnerAfterHalf(state);
  if (winner) {
    finishGame(state, winner, 'score', events);
    return;
  }

  if (state.half === 'top') {
    state.half = 'bottom';
  } else {
    state.half = 'top';
    state.inning += 1;
  }

  events.push(
    pushEvent(state, {
      kind: 'inning-start',
      text: `${getOffense(state).name} coming to bat in the ${state.half} of the ${ordinal(state.inning)}.`,
      refs: { side: getOffense(state).side },
    }),
  );
  state.needsHalfStart = true;
}

/**
 * Winner after a completed half, or null to keep playing.
 * After the top of the final regulation inning (or later): home ahead wins.
 * After the bottom: whoever leads wins; ties go to extras.
 */
export function winnerAfterHalf(state: GameState): Side | null {
  const { regulationInnings } = state.config;
  if (state.inning < regulationInnings) return null;
  if (state.half === 'top') return state.home.score > state.away.score ? 'home' : null;
  if (state.home.score > state.away.score) return 'home';
  if (state.away.score > state.home.score) return 'away';
  return null;
}

/** Ends the game the moment the home team takes the lead in the last half-inning. */
export function maybeWalkOff(state: GameState, events: GameEvent[]): boolean {
  const { regulationInnings } = state.config;
  if (
    state.phase === 'live' &&
    state.half === 'bottom' &&
    state.inning >= regulationInnings &&
    state.home.score > state.away.score
  ) {
    events.push(pushEvent(state, { kind: 'info', text: `Walk-off! ${state.home.name} win it in the bottom of the ${ordinal(state.inning)}!` }));
    finishGame(state, 'home', 'score', events);
    return true;
  }
  return false;
}

export function finishGame(state: GameState, winner: Side, endedBy: 'score' | 'concede', events: GameEvent[]): void {
  state.phase = 'finished';
  state.winner = winner;
  state.endedBy = endedBy;
  state.pendingDecision = null;
  state.pendingPlay = null;
  state.currentPa = null;
  state.needsHalfStart = false;
  const w = winner === 'home' ? state.home : state.away;
  const l = winner === 'home' ? state.away : state.home;
  events.push(
    pushEvent(state, {
      kind: 'game-over',
      text: `Ballgame! ${w.name} defeat ${l.name}, ${w.score}-${l.score}.`,
      refs: { side: winner },
    }),
  );
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? 'th');
}

/** A run scores: bookkeeping + event. */
export function scoreRun(state: GameState, runner: EnginePlayer, events: GameEvent[]): void {
  const offense = getOffense(state);
  offense.score += 1;
  creditRun(state, runner);
  runner.base = null;
  events.push(
    pushEvent(state, {
      kind: 'run',
      text: `${runner.name} scores! (${offense.name} ${offense.score})`,
      refs: { playerId: runner.id, side: offense.side, runCount: 1 },
    }),
  );
}

/** Force-advance chain on a walk: batter to 1st, pushing forced runners. */
export function applyWalkForces(state: GameState, batter: EnginePlayer, events: GameEvent[]): void {
  const offense = getOffense(state);
  const onBase = (b: number) => offense.players.find((p) => p.base === b && p.id !== batter.id);
  const first = onBase(1);
  if (first) {
    const second = onBase(2);
    if (second) {
      const third = onBase(3);
      if (third) scoreRun(state, third, events);
      second.base = 3;
    }
    first.base = 2;
  }
  batter.base = 1;
}
