import { creditRun } from './box.js';
import { pushEvent } from './events.js';
import type { Rng } from './rng.js';
import type { EnginePlayer, GameEvent, GameState, Side, TeamState } from './types.js';
import { otherSide, SIDES } from './types.js';
import {
  getDefense,
  getOffense,
  getTeam,
  isCloserInning,
  pitcherLegalOnMound,
  playerById,
  resolveSeason,
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

    // A roll that lands on an unusable season (a cup of coffee, an injury
    // year) skips to the next-older one, wrapping to the most recent. Say so
    // once per inning for the players it moves.
    const rules = rulesOf(state);
    for (const team of [state.away, state.home]) {
      for (const player of team.players) {
        if (player.status !== 'active') continue;
        let resolution;
        try {
          resolution = resolveSeason(player, team.yearRoll, rules);
        } catch {
          continue; // a card with no usable window: the manager's problem to see
        }
        if (resolution.skippedYear !== null) {
          events.push(
            pushEvent(state, {
              kind: 'info',
              text: `${player.name} (${team.name}) lands on his ${resolution.skippedYear} season — not a full year, so he plays his ${resolution.season.year} instead.`,
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
        text: `${pitcher.name} stays in to close out the ballgame.`,
        refs: { playerId: pitcher.id, side: defense.side },
      }),
    );
  }

  openPlateAppearance(state, events);
}

/**
 * Make sure the defense has a legal pitcher. Fatigue never forces a change —
 * a tired pitcher just pitches worse — so this only fires when nobody is on
 * the mound at all.
 */
function ensurePitcher(state: GameState, events: GameEvent[]): boolean {
  const defense = getDefense(state);
  const pitcher = defense.players.find((p) => p.id === defense.activePitcherId);
  const reason = pitcher ? pitcherLegalOnMound(state, pitcher) : { ok: false, reason: 'is missing' };
  if (reason.ok) return true;

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
 * Bookkeeping after a plate appearance resolves: lineup advance, then open
 * the next PA (or end the half).
 */
export function finishPlateAppearance(state: GameState, events: GameEvent[]): void {
  const pa = state.currentPa;
  state.currentPa = null;

  if (state.outs >= 3) {
    endHalfInning(state, events);
    return;
  }

  advanceLineupCursor(state);
  openPlateAppearance(state, events);
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

  // Feats worth celebrating (and, server-side, bonus packs): read from the
  // final box score before the curtain call.
  for (const feat of finalAchievements(state)) {
    recordAchievement(state, events, feat);
  }

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

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

/** Note a feat the moment it happens, in play code. */
export function recordAchievement(
  state: GameState,
  events: GameEvent[],
  achievement: { side: Side; kind: string; text: string; playerId?: string },
): void {
  // Games saved before feats existed have no list; start one on demand.
  if (!state.achievements) state.achievements = [];
  state.achievements.push({ side: achievement.side, kind: achievement.kind });
  events.push(
    pushEvent(state, {
      kind: 'achievement',
      text: achievement.text,
      refs: { side: achievement.side, ...(achievement.playerId ? { playerId: achievement.playerId } : {}) },
    }),
  );
}

/**
 * Feats read from the box score once the last out is recorded: a no-hitter,
 * a perfect game, a cycle. Only a game that ran its full length counts — a
 * concession in the third never throws a no-hitter here.
 */
function finalAchievements(state: GameState): { side: Side; kind: string; text: string; playerId?: string }[] {
  if (state.endedBy !== 'score') return [];
  const box = state.box;
  if (!box) return [];
  const out: { side: Side; kind: string; text: string; playerId?: string }[] = [];
  // A no-hitter needs at least this much work on the mound to be real: every
  // inning but the last, so a walk-off short start still counts.
  const minOuts = (state.config.regulationInnings - 1) * 3;

  for (const side of SIDES) {
    const opponent = otherSide(side);
    const pitching = Object.values(box[side]?.pitching ?? {});
    const outs = pitching.reduce((sum, p) => sum + p.outs, 0);
    const hits = pitching.reduce((sum, p) => sum + p.h, 0);
    const walks = pitching.reduce((sum, p) => sum + p.bb, 0);

    if (outs >= minOuts) {
      const team = getTeam(state, side).name;
      if (hits === 0 && walks === 0) {
        out.push({ side, kind: 'perfect-game', text: `${team} have thrown a PERFECT GAME!` });
      } else if (hits === 0) {
        out.push({ side, kind: 'no-hitter', text: `${team} have thrown a NO-HITTER!` });
      }
    }

    for (const [playerId, line] of Object.entries(box[side]?.batting ?? {})) {
      const singles = line.h - line.doubles - line.triples - line.hr;
      if (singles >= 1 && line.doubles >= 1 && line.triples >= 1 && line.hr >= 1) {
        const player = playerById(state, playerId);
        out.push({ side, kind: 'cycle', text: `${player?.name ?? 'A batter'} has hit for the CYCLE!`, playerId });
      }
    }
  }
  return out;
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
