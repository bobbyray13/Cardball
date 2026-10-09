import { describe, expect, it } from 'vitest';
import type { GameAction } from '@cardball/shared';
import { applyAction, waitingOn } from '../src/apply.js';
import { createGame } from '../src/create.js';
import { GameError } from '../src/errors.js';
import { OUT_OF_POSITION_RATING, fieldingRating, pitcherFatigue, pitcherTotalMod } from '../src/queries.js';
import { scriptedRng } from '../src/rng.js';
import type { GameState } from '../src/types.js';
import { neutralTeam, seasons } from './fixtures.js';

const ME = { userId: 1 };

/**
 * Hotseat game, neutral teams. Team A (index 0) wins the home roll with [6, 1],
 * both year rolls are 1. Away = Team B, batting first.
 */
function liveGame(innings = 9): GameState {
  const { state } = createGame(
    { id: 'g1', mode: 'hotseat', regulationInnings: innings, teams: [neutralTeam('a'), neutralTeam('b')] },
    scriptedRng([6, 1]),
  );
  return act(state, { type: 'start-game' }, [1, 1]);
}

function act(state: GameState, action: GameAction, dice: number[] = []): GameState {
  return applyAction(state, action, ME, scriptedRng(dice)).state;
}

function pitch(state: GameState, dice: number[]): GameState {
  return act(state, { type: 'throw-pitch' }, dice);
}

describe('game setup', () => {
  it('rolls for home and starts with the away team batting', () => {
    const state = liveGame();
    expect(state.home.name).toBe('Team A');
    expect(state.away.name).toBe('Team B');
    expect(state.phase).toBe('live');
    expect(state.currentPa?.batterId).toBe('b0');
    expect(state.currentPa?.pitcherId).toBe('asp');
  });

  it('rejects a lineup missing a position', () => {
    const team = neutralTeam('a');
    delete team.fieldPositions.SS;
    expect(() =>
      createGame({ id: 'g', mode: 'hotseat', regulationInnings: 9, teams: [team, neutralTeam('b')] }, scriptedRng([6, 1])),
    ).toThrow(GameError);
  });

  it('rejects a reliever as the starting pitcher', () => {
    const team = neutralTeam('a');
    team.startingPitcherId = 'arp1';
    expect(() =>
      createGame({ id: 'g', mode: 'hotseat', regulationInnings: 9, teams: [team, neutralTeam('b')] }, scriptedRng([6, 1])),
    ).toThrow(/not a starting pitcher/);
  });

  it('holds fielders to their cards, unless the match allows out of position', () => {
    // The DH (a first baseman) takes center; the center fielder bats DH.
    const team = neutralTeam('a');
    team.fieldPositions.CF = 'adh';
    const setup = { id: 'g', mode: 'hotseat' as const, regulationInnings: 9, teams: [team, neutralTeam('b')] as [typeof team, typeof team] };
    expect(() => createGame(setup, scriptedRng([6, 1]))).toThrow(/not eligible to field CF/);

    const match = { yearFrom: 1872, yearTo: 2100, rarityCaps: null, outOfPosition: true };
    const { state, events } = createGame({ ...setup, match }, scriptedRng([6, 1]));
    const cf = state.home.players.find((p) => p.id === 'adh')!;
    expect(cf.fieldPosition).toBe('CF');
    expect(fieldingRating(cf, 'CF')).toBe(OUT_OF_POSITION_RATING);
    expect(events.some((e) => /starts out of position at CF/.test(e.text))).toBe(true);
  });

  it('only 3, 6, or 9 inning games', () => {
    expect(() =>
      createGame({ id: 'g', mode: 'hotseat', regulationInnings: 7, teams: [neutralTeam('a'), neutralTeam('b')] }, scriptedRng([6, 1])),
    ).toThrow(GameError);
  });

  it('rejects a DH whose card cannot bat', () => {
    const team = neutralTeam('a');
    team.players.find((p) => p.id === 'adh')!.seasons = seasons({ ab: 20 });
    expect(() =>
      createGame({ id: 'g', mode: 'hotseat', regulationInnings: 9, teams: [team, neutralTeam('b')] }, scriptedRng([6, 1])),
    ).toThrow(/adh's card is not game-eligible/);
  });
});

describe('plate appearance', () => {
  it('pitcher wins the pitch roll: strikeout', () => {
    const state = pitch(liveGame(), [1, 6]);
    expect(state.outs).toBe(1);
    expect(state.currentPa?.batterId).toBe('b1');
  });

  it('three straight ties is a walk', () => {
    const state = pitch(liveGame(), [3, 3, 2, 2, 4, 4]);
    expect(state.away.players.find((p) => p.id === 'b0')?.base).toBe(1);
    expect(state.outs).toBe(0);
  });

  it('a non-tie resets nothing mid-PA: tie, tie, then contact resolves', () => {
    // ties ×2, then batter wins; direction 3, contact 5 (to SS), defense 10 ≥ 5 → out
    const state = pitch(liveGame(), [3, 3, 2, 2, 6, 1, 3, 5, 10]);
    expect(state.outs).toBe(1);
  });

  it('defender meets or beats contact: out', () => {
    const state = pitch(liveGame(), [6, 1, 3, 5, 5]);
    expect(state.outs).toBe(1);
  });

  it('contact beats defense: hit, power tier decides the kind', () => {
    // contact 12 → outfield (CF on direction 3); 0 doubles → single
    const state = pitch(liveGame(), [6, 1, 3, 12, 2]);
    expect(state.outs).toBe(0);
    expect(state.away.players.find((p) => p.id === 'b0')?.base).toBe(1);
  });

  it('natural 20 is a home run', () => {
    const state = pitch(liveGame(), [6, 1, 1, 20]);
    expect(state.away.score).toBe(1);
    expect(state.away.players.every((p) => p.base === null)).toBe(true);
  });

  it('three outs flips the half and the other team bats', () => {
    let state = liveGame();
    for (let i = 0; i < 3; i++) state = pitch(state, [1, 6]);
    expect(state.half).toBe('bottom');
    expect(state.outs).toBe(0);
    expect(state.currentPa?.batterId).toBe('a0');
    expect(state.away.lineupCursor).toBe(3);
  });
});

describe('steals', () => {
  it('runner beats the catcher (ties go to the runner)', () => {
    let state = pitch(liveGame(), [6, 1, 3, 12, 2]); // single
    state = act(state, { type: 'attempt-steal', runnerId: 'b0' }, [3, 3]);
    expect(state.away.players.find((p) => p.id === 'b0')?.base).toBe(2);
  });

  it('catcher throws him out', () => {
    let state = pitch(liveGame(), [6, 1, 3, 12, 2]);
    state = act(state, { type: 'attempt-steal', runnerId: 'b0' }, [2, 5]);
    expect(state.away.players.find((p) => p.id === 'b0')?.base).toBeNull();
    expect(state.outs).toBe(1);
  });

  it('catcher gets +1 on a steal of third', () => {
    let state = pitch(liveGame(), [6, 1, 3, 12, 2]);
    state = act(state, { type: 'attempt-steal', runnerId: 'b0' }, [3, 3]);
    state = act(state, { type: 'attempt-steal', runnerId: 'b0' }, [3, 3]); // 3 vs 3+1
    expect(state.outs).toBe(1);
  });
});

describe('double play', () => {
  it('pauses for the defense, then turns two on a big roll', () => {
    let state = pitch(liveGame(), [6, 1, 3, 12, 2]); // runner on 1st
    // grounder (contact 4) to SS on direction 3, defense 15
    state = pitch(state, [6, 1, 3, 4, 15]);
    expect(state.pendingDecision?.kind).toBe('dp-attempt');
    // diff 11 + fielding 0 − speed 0 + d20 10 = 21 > 20
    state = act(state, { type: 'dp-attempt', attempt: true }, [10]);
    expect(state.outs).toBe(2);
    expect(state.away.players.every((p) => p.base === null)).toBe(true);
  });

  it('a failed attempt is a fielder\'s choice', () => {
    let state = pitch(liveGame(), [6, 1, 3, 12, 2]);
    state = pitch(state, [6, 1, 3, 4, 5]);
    state = act(state, { type: 'dp-attempt', attempt: true }, [1]);
    expect(state.outs).toBe(1);
    expect(state.away.players.find((p) => p.id === 'b1')?.base).toBe(1);
    expect(state.away.players.find((p) => p.id === 'b0')?.base).toBeNull();
  });

  it('batter speed works against the defense', () => {
    // A 70-SB burner at the plate: the same dice that turn two on a neutral
    // batter (21 > 20) now total 21 − 3 = 18.
    const away = neutralTeam('b');
    away.players.find((p) => p.id === 'b1')!.seasons = seasons({ sb: 70 });
    const { state: created } = createGame(
      { id: 'g1', mode: 'hotseat', regulationInnings: 9, teams: [neutralTeam('a'), away] },
      scriptedRng([6, 1]),
    );
    let state = act(created, { type: 'start-game' }, [1, 1]);
    state = pitch(state, [6, 1, 3, 12, 2]); // b0 singles
    state = pitch(state, [6, 1, 3, 4, 15]); // burner b1 grounds to SS
    expect(state.pendingDecision?.kind).toBe('dp-attempt');
    // diff 11 + fielding 0 − speed 3 + d20 10 = 18 ≤ 20 → safe at first
    state = act(state, { type: 'dp-attempt', attempt: true }, [10]);
    expect(state.outs).toBe(1);
    expect(state.away.players.find((p) => p.id === 'b1')?.base).toBe(1);
    expect(state.away.players.find((p) => p.id === 'b0')?.base).toBeNull();
  });
});

describe('send runner', () => {
  it('offense decides on the lead runner, tie goes to the runner', () => {
    let state = pitch(liveGame(), [6, 1, 3, 12, 2]); // b0 on 1st
    state = pitch(state, [6, 1, 3, 12, 2]); // single: b0 to 2nd, may try for 3rd
    expect(state.pendingDecision?.kind).toBe('send-runner');
    state = act(state, { type: 'send-runner', send: true }, [4, 4]);
    expect(state.away.players.find((p) => p.id === 'b0')?.base).toBe(3);
    expect(state.away.players.find((p) => p.id === 'b1')?.base).toBe(1);
  });

  it('runner re-rolls 1s', () => {
    let state = pitch(liveGame(), [6, 1, 3, 12, 2]);
    state = pitch(state, [6, 1, 3, 12, 2]);
    state = act(state, { type: 'send-runner', send: true }, [1, 1, 5, 6]); // 5 vs 6 → out
    expect(state.outs).toBe(1);
  });

  it('holding the runner keeps the default advance', () => {
    let state = pitch(liveGame(), [6, 1, 3, 12, 2]);
    state = pitch(state, [6, 1, 3, 12, 2]);
    state = act(state, { type: 'send-runner', send: false });
    expect(state.away.players.find((p) => p.id === 'b0')?.base).toBe(2);
  });
});

describe('ending the game', () => {
  function threeOutsPitches(state: GameState): GameState {
    for (let i = 0; i < 3; i++) state = pitch(state, [1, 6]);
    return state;
  }

  it('home team ahead after the top of the last inning wins without batting', () => {
    let state = liveGame(3);
    state = threeOutsPitches(state); // top 1
    state = pitch(state, [6, 1, 1, 20]); // home HR
    state = threeOutsPitches(state);
    for (let i = 0; i < 3; i++) state = threeOutsPitches(state); // top 2, bot 2, top 3
    expect(state.phase).toBe('finished');
    expect(state.winner).toBe('home');
    expect(state.inning).toBe(3);
  });

  it('walk-off ends the game the moment home takes the lead', () => {
    let state = liveGame(3);
    for (let i = 0; i < 5; i++) state = threeOutsPitches(state);
    expect(state.half).toBe('bottom');
    expect(state.inning).toBe(3);
    state = pitch(state, [6, 1, 1, 20]);
    expect(state.phase).toBe('finished');
    expect(state.winner).toBe('home');
  });

  it('a tie after regulation goes to extras', () => {
    let state = liveGame(3);
    for (let i = 0; i < 6; i++) state = threeOutsPitches(state);
    expect(state.phase).toBe('live');
    expect(state.inning).toBe(4);
  });

  it('concede', () => {
    const state = act(liveGame(), { type: 'concede', side: 'away' });
    expect(state.winner).toBe('home');
    expect(state.endedBy).toBe('concede');
  });
});

describe('permissions', () => {
  it('rejects actions from someone not in the game', () => {
    expect(() => applyAction(liveGame(), { type: 'throw-pitch' }, { userId: 99 }, scriptedRng([]))).toThrow(/not managing/);
  });

  it('blocks other actions while a decision is pending', () => {
    let state = pitch(liveGame(), [6, 1, 3, 12, 2]);
    state = pitch(state, [6, 1, 3, 4, 15]);
    expect(() => act(state, { type: 'throw-pitch' })).toThrow(/Waiting on a decision/);
  });

  it('never mutates the input state', () => {
    const before = liveGame();
    const snapshot = JSON.stringify(before);
    pitch(before, [6, 1, 1, 20]);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('pitching and fatigue', () => {
  it('never forces a change: a starter may pitch on, at a cost', () => {
    let state = liveGame();
    // 4 innings of 1-2-3: both teams' starters have 12 outs.
    for (let half = 0; half < 8; half++) for (let i = 0; i < 3; i++) state = pitch(state, [1, 6]);
    expect(state.inning).toBe(5);
    expect(state.pendingDecision).toBeNull();
    expect(state.home.activePitcherId).toBe('asp');
  });

  it('a starter is fresh for five innings, then wears a -1 per inning', () => {
    let state = liveGame();
    for (let half = 0; half < 8; half++) for (let i = 0; i < 3; i++) state = pitch(state, [1, 6]);
    // Five innings in the books: still fresh entering the 6th.
    expect(pitcherFatigue(state, state.home.players.find((p) => p.id === 'asp')!)).toBe(0);
    for (let half = 8; half < 12; half++) for (let i = 0; i < 3; i++) state = pitch(state, [1, 6]);
    // Six innings in the books: -2 entering the 7th (one from each inning past five).
    const sp = state.home.players.find((p) => p.id === 'asp')!;
    expect(pitcherFatigue(state, sp)).toBe(-2);
    expect(pitcherTotalMod(state, sp).mod).toBe(-2);
    // The roll notes tell the manager what he is losing.
    expect(pitcherTotalMod(state, sp).note).toMatch(/fatigue -2/);
  });

  it('a reliever loses a point with every inning he pitches', () => {
    let state = pitch(liveGame(), [1, 6]); // out 1, asp on the mound
    state = act(state, { type: 'pitcher-change', inPlayerId: 'arp1' });
    const rp = () => state.home.players.find((p) => p.id === 'arp1')!;
    for (let i = 0; i < 2; i++) state = pitch(state, [1, 6]); // he closes out the top of the 1st
    expect(pitcherFatigue(state, rp())).toBe(0); // two outs: no complete inning yet
    for (let i = 0; i < 3; i++) state = pitch(state, [1, 6]); // bottom 1: home bats
    for (let i = 0; i < 3; i++) state = pitch(state, [1, 6]); // his first full inning, the top of the 2nd
    expect(pitcherFatigue(state, rp())).toBe(-1);
    for (let i = 0; i < 3; i++) state = pitch(state, [1, 6]); // bottom 2
    for (let i = 0; i < 3; i++) state = pitch(state, [1, 6]); // top 3
    expect(pitcherFatigue(state, rp())).toBe(-2);
  });

  it('scales the fresh innings to shorter games', () => {
    // Six-inning games: fresh for the first three innings, -1 per inning after.
    let six = liveGame(6);
    for (let half = 0; half < 4; half++) for (let i = 0; i < 3; i++) six = pitch(six, [1, 6]);
    expect(pitcherFatigue(six, six.home.players.find((p) => p.id === 'asp')!)).toBe(0); // 2 IP, fresh
    for (let half = 4; half < 6; half++) for (let i = 0; i < 3; i++) six = pitch(six, [1, 6]);
    expect(pitcherFatigue(six, six.home.players.find((p) => p.id === 'asp')!)).toBe(-1); // 3 IP
    for (let half = 6; half < 8; half++) for (let i = 0; i < 3; i++) six = pitch(six, [1, 6]);
    expect(pitcherFatigue(six, six.home.players.find((p) => p.id === 'asp')!)).toBe(-2); // 4 IP

    // Three-inning games: fresh for the first two innings, -1 in the third.
    let three = liveGame(3);
    for (let half = 0; half < 4; half++) for (let i = 0; i < 3; i++) three = pitch(three, [1, 6]);
    expect(pitcherFatigue(three, three.home.players.find((p) => p.id === 'asp')!)).toBe(-1); // 2 IP
  });

  it('starters and relievers alike may enter at any point', () => {
    let state = pitch(liveGame(), [1, 6]);
    state.inning = 8;
    expect(() => act(state, { type: 'pitcher-change', inPlayerId: 'asp2' })).not.toThrow();
    expect(() => act(state, { type: 'pitcher-change', inPlayerId: 'arp1' })).not.toThrow();
  });
});

describe('paced pitching', () => {
  /** Hotseat, paced: the defense throws the pitcher's die, then the offense rolls. */
  function pacedGame(innings = 9): GameState {
    const { state } = createGame(
      { id: 'g2', mode: 'hotseat', regulationInnings: innings, pacedPitch: true, teams: [neutralTeam('a'), neutralTeam('b')] },
      scriptedRng([6, 1]),
    );
    return act(state, { type: 'start-game' }, [1, 1]);
  }

  it('leaves an unpaced game resolving the roll in one throw', () => {
    const state = liveGame();
    expect(state.config.pacedPitch).toBeUndefined();
    // Team B bats first, so the offense holds the throw.
    expect(waitingOn(state)).toMatchObject({ side: 'away', kind: 'throw-pitch' });
  });

  it('asks the defense to throw, then the offense to roll', () => {
    const thrown = applyAction(pacedGame(), { type: 'throw-pitch' }, ME, scriptedRng([4]));
    // The pitcher's die is on the table before the batter commits.
    expect(thrown.events.some((e) => e.kind === 'pitch')).toBe(true);
    expect(thrown.state.pendingDecision).toMatchObject({ kind: 'batter-roll', side: 'away' });
    expect(thrown.state.pendingDecision?.detail?.pitcherRoll).toBe(4);
    expect(waitingOn(thrown.state)).toMatchObject({ side: 'away', kind: 'batter-roll' });

    // The offense rolls: 5 over the pitcher's 4 → contact.
    const rolled = applyAction(thrown.state, { type: 'roll-bat' }, ME, scriptedRng([5, 3, 12]));
    expect(rolled.state.pendingDecision).toBeNull();
    expect(rolled.events.some((e) => e.kind === 'pitch' && /makes contact/.test(e.text))).toBe(true);
  });

  it('a tie is a ball, and the pitcher throws again', () => {
    const thrown = applyAction(pacedGame(), { type: 'throw-pitch' }, ME, scriptedRng([4]));
    const rolled = applyAction(thrown.state, { type: 'roll-bat' }, ME, scriptedRng([4]));
    expect(rolled.events.some((e) => e.kind === 'ball')).toBe(true);
    expect(rolled.state.pendingDecision).toBeNull();
    expect(rolled.state.currentPa?.balls).toBe(1);
    expect(waitingOn(rolled.state)).toMatchObject({ side: 'home', kind: 'throw-pitch' });
  });

  it('a high pitcher roll strikes the batter out', () => {
    const thrown = applyAction(pacedGame(), { type: 'throw-pitch' }, ME, scriptedRng([6]));
    const rolled = applyAction(thrown.state, { type: 'roll-bat' }, ME, scriptedRng([1]));
    expect(rolled.events.some((e) => e.kind === 'out' && /strikes out/.test(e.text))).toBe(true);
    expect(rolled.state.outs).toBe(1);
  });

  it('refuses a batter roll before the pitcher has thrown', () => {
    expect(() => act(pacedGame(), { type: 'roll-bat' })).toThrow(/No batter roll/);
  });
});
