import { contactInfo, resolveHitKind, sbMod } from '@cardball/shared';
import type { Position } from '@cardball/shared';
import { pushEvent, roll } from './events.js';
import { GameError } from './errors.js';
import type { Rng } from './rng.js';
import type { EnginePlayer, GameEvent, GameState, PlayContext, Side } from './types.js';
import {
  batterPitchMod,
  batterRbiBonus,
  contactAdvantage,
  fielderAt,
  fieldingRating,
  fmtMod,
  getDefense,
  getOffense,
  leadRunner,
  pitcherPitchMod,
  rulesOf,
  seasonForPlayer,
  sprayDirection,
} from './queries.js';
import { applyWalkForces, finishPlateAppearance, maybeWalkOff, scoreRun } from './flow.js';
import { creditOut, creditPlateAppearance } from './box.js';

/** Scoring-notation position numbers (1 P … 9 RF). */
const POSITION_NUMBERS: Record<Position, string> = {
  P: '1',
  C: '2',
  '1B': '3',
  '2B': '4',
  '3B': '5',
  SS: '6',
  LF: '7',
  CF: '8',
  RF: '9',
  DH: '',
};

/** Record an out: outs, pitcher innings, event. */
export function recordOut(state: GameState, events: GameEvent[], text: string, playerId?: string, side?: Side): void {
  state.outs += 1;
  const defense = getDefense(state);
  if (defense.activePitcherId) {
    const pitcher = defense.players.find((p) => p.id === defense.activePitcherId);
    if (pitcher) pitcher.outsPitched += 1;
  }
  creditOut(state);
  events.push(
    pushEvent(state, {
      kind: 'out',
      text,
      ...(playerId !== undefined ? { refs: { playerId, ...(side ? { side } : {}) } } : {}),
    }),
  );
}

/** Which defender fields a ball hit to `direction` with power `contactRoll`. */
export function pickDefender(state: GameState, direction: number, contactRoll: number, rng: Rng): EnginePlayer | null {
  const chart = sprayDirection(state, direction);
  if (!chart) throw new GameError(`Invalid direction roll: ${direction}`);
  const positions = contactRoll <= 10 ? chart.infield : chart.outfield;
  const defense = getDefense(state);

  let best: EnginePlayer | null = null;
  let bestRating = -Infinity;
  for (const pos of positions) {
    const player = fielderAt(state, defense.side, pos);
    if (!player) continue;
    const rating = fieldingRating(player, pos);
    if (rating > bestRating || (rating === bestRating && rng.int(0, 1) === 1)) {
      best = player;
      bestRating = rating;
    }
  }
  return best;
}

/** The thrower on a ball through the outfield: the OF in the hit direction. */
function throwerForDirection(state: GameState, direction: number): EnginePlayer | null {
  const outfield = sprayDirection(state, direction)?.outfield ?? [];
  const defense = getDefense(state);
  for (const pos of outfield) {
    const player = fielderAt(state, defense.side, pos);
    if (player) return player;
  }
  return fielderAt(state, defense.side, 'CF');
}

/** Highest forced base (3 when bases loaded, 2 with 1st+2nd, 1 with 1st, 0 otherwise). */
export function leadForcedBase(state: GameState): 0 | 1 | 2 | 3 {
  const offense = getOffense(state);
  const occupied = (b: number) => offense.players.some((p) => p.base === b);
  if (occupied(1) && occupied(2) && occupied(3)) return 3;
  if (occupied(1) && occupied(2)) return 2;
  if (occupied(1)) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// throw-pitch: resolve the whole plate appearance, pausing for decisions.
// ---------------------------------------------------------------------------

/** The pitch roll: pitcher vs batter, ties are balls. Resolves the whole PA. */
export function applyThrowPitch(state: GameState, rng: Rng): GameEvent[] {
  if (state.phase !== 'live') throw new GameError('The game is not in progress');
  if (state.pendingDecision || state.pendingPlay) throw new GameError('A decision is pending');
  const pa = state.currentPa;
  if (!pa) throw new GameError('No plate appearance in progress');

  state.firstPitchThrown = true;
  const events: GameEvent[] = [];

  const offense = getOffense(state);
  const defense = getDefense(state);
  const batter = offense.players.find((p) => p.id === pa.batterId);
  const pitcher = defense.players.find((p) => p.id === pa.pitcherId);
  if (!batter || !pitcher) throw new GameError('Plate appearance has missing players');

  const batterSeason = seasonForPlayer(state, batter);
  const pitcherSeason = seasonForPlayer(state, pitcher);

  // Paced: the pitcher's roll goes on the table, and the batter answers it.
  if (state.config.pacedPitch) {
    const { mod: pMod, note: pNote } = pitcherPitchMod(pitcherSeason, rulesOf(state));
    const pRoll = rng.d6();
    const pTotal = pRoll + pMod;
    events.push(
      pushEvent(state, {
        kind: 'pitch',
        text: `${pitcher.name} deals — d6 ${pRoll} ${fmtMod(pMod)} = ${pTotal}. ${batter.name}, roll the bat.`,
        rolls: [roll(`${pitcher.name} (pitching)`, 6, pRoll, pMod, pNote)],
        refs: { playerId: pitcher.id, side: defense.side },
      }),
    );
    state.pendingDecision = {
      kind: 'batter-roll',
      side: offense.side,
      prompt: `${pitcher.name} rolls ${pTotal} — ${batter.name} steps in to roll.`,
      detail: { pitcherRoll: pRoll, pitcherTotal: pTotal },
    };
    return events;
  }

  // ---- pitch roll loop: pitcher vs batter, ties are balls ----
  while (true) {
    const { mod: bBase, note: bNote } = batterPitchMod(batterSeason, rulesOf(state));
    const bRbi = batterRbiBonus(state, batter, batterSeason);
    const { mod: pMod, note: pNote } = pitcherPitchMod(pitcherSeason, rulesOf(state));

    const bRoll = rng.d6();
    const pRoll = rng.d6();
    const bTotal = bRoll + bBase + bRbi;
    const pTotal = pRoll + pMod;

    const rolls = [
      roll(`${batter.name} (batting)`, 6, bRoll, bBase + bRbi, `${bNote}${bRbi ? `, ${bRbi} RBI bonus` : ''}`),
      roll(`${pitcher.name} (pitching)`, 6, pRoll, pMod, pNote),
    ];

    if (resolvePitch(state, events, rng, batter, pitcher, batterSeason, bTotal, pTotal, rolls) === 'ended') return events;
  }
}

/**
 * The offense's answer to a paced pitch: roll the batter's die against the
 * pitcher's total already on the table, then resolve the plate appearance. A
 * tie is another ball, and the pitcher throws again.
 */
export function applyRollBat(state: GameState, rng: Rng): GameEvent[] {
  if (state.phase !== 'live') throw new GameError('The game is not in progress');
  const decision = state.pendingDecision;
  if (!decision || decision.kind !== 'batter-roll') throw new GameError('No batter roll is pending');
  const pa = state.currentPa;
  if (!pa) throw new GameError('No plate appearance in progress');

  const offense = getOffense(state);
  const defense = getDefense(state);
  const batter = offense.players.find((p) => p.id === pa.batterId);
  const pitcher = defense.players.find((p) => p.id === pa.pitcherId);
  if (!batter || !pitcher) throw new GameError('Plate appearance has missing players');

  state.pendingDecision = null;
  const events: GameEvent[] = [];

  const batterSeason = seasonForPlayer(state, batter);
  const pitcherSeason = seasonForPlayer(state, pitcher);
  const { mod: bBase, note: bNote } = batterPitchMod(batterSeason, rulesOf(state));
  const bRbi = batterRbiBonus(state, batter, batterSeason);
  const { mod: pMod, note: pNote } = pitcherPitchMod(pitcherSeason, rulesOf(state));

  const pRoll = decision.detail?.pitcherRoll ?? 0;
  const pTotal = decision.detail?.pitcherTotal ?? pRoll + pMod;
  const bRoll = rng.d6();
  const bTotal = bRoll + bBase + bRbi;

  const rolls = [
    roll(`${batter.name} (batting)`, 6, bRoll, bBase + bRbi, `${bNote}${bRbi ? `, ${bRbi} RBI bonus` : ''}`),
    roll(`${pitcher.name} (pitching)`, 6, pRoll, pMod, pNote),
  ];

  resolvePitch(state, events, rng, batter, pitcher, batterSeason, bTotal, pTotal, rolls);
  return events;
}

/**
 * Compare one pitch's totals and either end the plate appearance or, on a tie,
 * record a ball and ask for another roll.
 */
function resolvePitch(
  state: GameState,
  events: GameEvent[],
  rng: Rng,
  batter: EnginePlayer,
  pitcher: EnginePlayer,
  batterSeason: ReturnType<typeof seasonForPlayer>,
  bTotal: number,
  pTotal: number,
  rolls: ReturnType<typeof roll>[],
): 'ended' | 'retry' {
  const offense = getOffense(state);
  const pa = state.currentPa;
  if (!pa) throw new GameError('No plate appearance in progress');

  if (pTotal > bTotal) {
    // Strikeout.
    events.push(pushEvent(state, { kind: 'pitch', text: `Pitch roll: ${pitcher.name} ${pTotal} vs ${batter.name} ${bTotal}.`, rolls }));
    creditPlateAppearance(state, 'strikeout');
    recordOut(state, events, `${batter.name} strikes out (pitch roll ${pTotal} over ${bTotal}).`, batter.id, offense.side);
    finishPlateAppearance(state, events);
    return 'ended';
  }

  if (bTotal > pTotal) {
    // Contact!
    events.push(pushEvent(state, { kind: 'pitch', text: `${batter.name} makes contact (pitch roll ${bTotal} over ${pTotal}).`, rolls }));
    resolveContact(state, events, rng, batter, pitcher, batterSeason);
    return 'ended';
  }

  // Tie: ball.
  pa.balls += 1;
  events.push(pushEvent(state, { kind: 'ball', text: `Dead even — ball ${pa.balls}. Re-roll.`, rolls }));
  if (pa.balls >= rulesOf(state).walkBalls) {
    events.push(
      pushEvent(state, {
        kind: 'walk',
        text: `${pa.balls} straight — ${batter.name} draws the walk.`,
        refs: { playerId: batter.id, side: offense.side },
      }),
    );
    creditPlateAppearance(state, 'walk');
    applyWalkForces(state, batter, events);
    if (state.phase === 'live' && maybeWalkOff(state, events)) return 'ended';
    finishPlateAppearance(state, events);
    return 'ended';
  }
  return 'retry';
}

// ---------------------------------------------------------------------------
// Contact: direction, power, defense
// ---------------------------------------------------------------------------

function resolveContact(
  state: GameState,
  events: GameEvent[],
  rng: Rng,
  batter: EnginePlayer,
  pitcher: EnginePlayer,
  batterSeason: ReturnType<typeof seasonForPlayer>,
): void {
  const rules = rulesOf(state);
  const direction = rng.d6();
  const contactRoll = rng.d20();
  const info = contactInfo(contactRoll);

  events.push(
    pushEvent(state, {
      kind: 'contact',
      text: `${batter.name} rolls contact: d6 ${direction} (direction), d20 ${contactRoll} — a ${info.type}!`,
      rolls: [roll('Hit direction', 6, direction, 0), roll('Contact', 20, contactRoll, 0)],
      refs: { playerId: batter.id, directionRoll: direction, contactRoll, contactType: info.type },
    }),
  );

  // Natural 20: automatic home run, no fielding chance.
  if (contactRoll === 20) {
    events.push(
      pushEvent(state, {
        kind: 'hit',
        text: `A natural 20 — ${batter.name} CRUSHES it. Home run!`,
        refs: { playerId: batter.id, hitKind: 'home-run', contactRoll },
      }),
    );
    creditPlateAppearance(state, 'home-run');
    applyAdvancesForHit(state, events, batter, 4);
    if (state.phase === 'live') maybeWalkOff(state, events);
    if (state.phase === 'live') finishPlateAppearance(state, events);
    return;
  }

  const defender = pickDefender(state, direction, contactRoll, rng);
  if (!defender) {
    // Defensive gap (should not happen with a full lineup): treat as a single.
    events.push(
      pushEvent(state, { kind: 'hit', text: `Nobody home — ${batter.name} slips a single through.`, refs: { hitKind: 'single' } }),
    );
    creditPlateAppearance(state, 'single');
    applyAdvancesForHit(state, events, batter, 1);
    if (state.phase === 'live') maybeWalkOff(state, events);
    if (state.phase === 'live') finishPlateAppearance(state, events);
    return;
  }

  const fRating = fieldingRating(defender, defender.fieldPosition ?? 'C');
  const dRoll = rng.d20();
  const dTotal = dRoll + fRating;

  events.push(
    pushEvent(state, {
      kind: 'fielding',
      text: `${defender.name} (${defender.fieldPosition}) dives: d20 ${dRoll} ${fmtMod(fRating)} = ${dTotal} vs contact ${contactRoll}.`,
      rolls: [roll(`${defender.name} fielding`, 20, dRoll, fRating, `${defender.fieldPosition} rating`)],
      refs: { playerId: defender.id, position: defender.fieldPosition },
    }),
  );

  const outsBefore = state.outs;

  if (dTotal >= contactRoll) {
    // The defender fields it — out, pending DP / tag-up choices.
    const ctx: PlayContext = {
      batterId: batter.id,
      pitcherId: pitcher.id,
      directionRoll: direction,
      contactRoll,
      contact: info,
      defenderId: defender.id,
      defenseRoll: dRoll,
      hitKind: null,
      stage: 'finish',
    };

    // Double play chance: grounder, force at first, fewer than two outs.
    if (info.type === 'grounder' && leadForcedBase(state) > 0 && outsBefore < 2) {
      const dpFactors = dpFactorPreview(state, ctx);
      state.pendingPlay = { ...ctx, stage: 'await-dp' };
      state.pendingDecision = {
        kind: 'dp-attempt',
        side: getDefense(state).side,
        prompt: `${defender.name} fields it with a runner forced — try to turn two?`,
        detail: { dpFactors },
      };
      return;
    }

    // Tag-up chance: caught fly, lead runner on 2nd/3rd, fewer than two outs.
    if (outsBefore < 2 && (info.type === 'fly' || info.type === 'deep-fly') && defenderIsOutfielder(defender)) {
      const lead = leadRunner(getOffense(state));
      if (lead && (lead.base === 2 || lead.base === 3)) {
        const toBase = (lead.base + 1) as number;
        state.pendingPlay = {
          ...ctx,
          stage: 'await-tag',
          send: {
            runnerId: lead.id,
            fromBase: lead.base,
            toBase,
            throwerId: defender.id,
            advantage: contactAdvantage(contactRoll, rules),
            context: 'tag-up',
          },
        };
        state.pendingDecision = {
          kind: 'send-runner',
          side: getOffense(state).side,
          playerId: lead.id,
          prompt: `${defender.name} makes the catch — ${lead.name} tags up and tries for ${baseName(toBase)}?`,
          detail: { targetBase: toBase, throwerId: defender.id, runnerAdvantage: contactAdvantage(contactRoll, rules) },
        };
        return;
      }
    }

    // Simple out.
    creditPlateAppearance(state, 'out');
    recordOut(
      state,
      events,
      `${defender.name} makes the play — ${batter.name} is out. Score it ${scoringNotation(defender, info.type)}.`,
      batter.id,
      getOffense(state).side,
    );
    if (state.outs >= 3) {
      finishPlateAppearance(state, events);
    } else {
      finishPlateAppearance(state, events);
    }
    return;
  }

  // ---- HIT ----
  const hitKind = resolveHitKind(
    contactRoll,
    {
      doubles: batterSeason.doubles,
      triples: batterSeason.triples,
      homeRuns: batterSeason.homeRuns,
    },
    rules.powerTiers,
  );
  const hitName = { single: 'single', double: 'double', triple: 'triple', 'home-run': 'home run' }[hitKind];
  events.push(
    pushEvent(state, {
      kind: 'hit',
      text: `Past ${defender.name}! ${batter.name} with a ${hitName}.`,
      refs: { playerId: batter.id, hitKind, contactRoll },
    }),
  );
  creditPlateAppearance(state, hitKind);

  const advance = { single: 1, double: 2, triple: 3, 'home-run': 4 }[hitKind];

  // Send-runner chance: lead runner could try one extra base.
  const lead = leadRunner(getOffense(state));
  if (lead && lead.base !== null && lead.base + advance <= 3) {
    const leadBase = lead.base;
    const toBase = leadBase + advance + 1;
    const thrower = throwerForDirection(state, direction);
    state.pendingPlay = {
      batterId: batter.id,
      pitcherId: pitcher.id,
      directionRoll: direction,
      contactRoll,
      contact: info,
      defenderId: defender.id,
      defenseRoll: dRoll,
      hitKind,
      stage: 'await-send',
      send: {
        runnerId: lead.id,
        fromBase: leadBase,
        toBase,
        throwerId: thrower?.id ?? defender.id,
        advantage: contactAdvantage(contactRoll, rules),
        context: 'hit',
      },
    };
    state.pendingDecision = {
      kind: 'send-runner',
      side: getOffense(state).side,
      playerId: lead.id,
      prompt: `${lead.name} into ${baseName(leadBase + advance)} — send him for ${baseName(toBase)}?`,
      detail: { targetBase: toBase, throwerId: thrower?.id ?? defender.id, runnerAdvantage: contactAdvantage(contactRoll, rules) },
    };
    return;
  }

  applyAdvancesForHit(state, events, batter, advance);
  if (state.phase === 'live') maybeWalkOff(state, events);
  if (state.phase === 'live') finishPlateAppearance(state, events);
}

// ---------------------------------------------------------------------------
// Decisions (dp-attempt / send-runner) — continuations of a paused play
// ---------------------------------------------------------------------------

export function applyDpDecision(state: GameState, attempt: boolean, rng: Rng): GameEvent[] {
  const ctx = state.pendingPlay;
  const decision = state.pendingDecision;
  if (!ctx || !decision || ctx.stage !== 'await-dp') throw new GameError('No double play decision pending');
  state.pendingPlay = null;
  state.pendingDecision = null;

  const events: GameEvent[] = [];
  const offense = getOffense(state);
  const defense = getDefense(state);
  const batter = offense.players.find((p) => p.id === ctx.batterId);
  const defender = defense.players.find((p) => p.id === ctx.defenderId);
  if (!batter || !defender) throw new GameError('Missing players in double play context');
  // Out, double play, or fielder's choice: an at-bat without a hit either way.
  creditPlateAppearance(state, 'out');

  if (!attempt) {
    recordOut(
      state,
      events,
      `${defender.name} plays it safe — ${batter.name} is out at first. Score it ${scoringNotation(defender, 'grounder')}.`,
      batter.id,
      offense.side,
    );
    finishPlateAppearance(state, events);
    return events;
  }

  // Factors: (defense − contact) + fielding of involved defenders − batter SB + d20.
  // Batter speed works against the defense: a burner is harder to double up.
  const diff = (ctx.defenseRoll ?? 0) - ctx.contactRoll;
  const involved = dpInvolvedDefenders(state, defender);
  const fieldingSum = involved.reduce((sum, p) => sum + fieldingRating(p, p.fieldPosition ?? 'C'), 0);
  const batterSeason = seasonForPlayer(state, batter);
  const bSb = sbMod(batterSeason.sb, rulesOf(state).sbBands);
  const dpRoll = rng.d20();
  const total = diff + fieldingSum - bSb + dpRoll;

  const rolls = [
    roll('Contact vs defense gap', 20, 0, diff, 'difference'),
    roll(`${involved.map((p) => p.name).join(' + ')} fielding`, 6, 0, fieldingSum, 'defense ratings'),
    roll(`${batter.name} speed`, 6, 0, -bSb, `${batterSeason.sb} SB`),
    roll('Double play roll', 20, dpRoll, 0),
  ];

  const forcedBase = leadForcedBase(state);
  const leadForced = offense.players.find((p) => p.base === forcedBase);
  if (leadForced) leadForced.base = null;
  advanceTrailingForcedRunners(state, forcedBase);

  if (total > rulesOf(state).dpTarget) {
    batter.base = null;
    recordOut(state, events, `${leadForced?.name ?? 'The lead runner'} is forced out.`, leadForced?.id, offense.side);
    recordOut(state, events, `${defender.name} turns it — DOUBLE PLAY! (${total} > ${rulesOf(state).dpTarget})`, batter.id, offense.side);
    events.push(
      pushEvent(state, {
        kind: 'dp-made',
        text: `Twin killing — score it ${dpNotation(defender)}.`,
        rolls,
      }),
    );
  } else {
    batter.base = 1;
    recordOut(
      state,
      events,
      `${total} — not enough to turn two! ${leadForced?.name ?? 'The lead runner'} is out, ${batter.name} reaches on the fielder's choice.`,
      leadForced?.id,
      offense.side,
    );
    events.push(
      pushEvent(state, {
        kind: 'dp-failed',
        text: `Score it ${scoringNotation(defender, 'grounder')} — fielder's choice, out at ${baseName(forcedBase + 1)}.`,
        rolls,
      }),
    );
  }

  if (state.phase === 'live') finishPlateAppearance(state, events);
  return events;
}

export function applySendDecision(state: GameState, send: boolean, rng: Rng): GameEvent[] {
  const ctx = state.pendingPlay;
  const decision = state.pendingDecision;
  if (!ctx || !decision || (ctx.stage !== 'await-send' && ctx.stage !== 'await-tag')) {
    throw new GameError('No send-runner decision pending');
  }
  state.pendingPlay = null;
  state.pendingDecision = null;

  const events: GameEvent[] = [];
  const offense = getOffense(state);
  const batter = offense.players.find((p) => p.id === ctx.batterId);

  const isTagUp = ctx.stage === 'await-tag';
  const runnerId = ctx.send?.runnerId ?? decision.playerId;
  const runner = offense.players.find((p) => p.id === runnerId);
  const toBase = ctx.send?.toBase ?? 0;
  const advantage = ctx.send?.advantage ?? 0;
  const throwerId = ctx.send?.throwerId ?? ctx.defenderId ?? null;
  const thrower = throwerId ? getDefense(state).players.find((p) => p.id === throwerId) : undefined;

  if (!runner || !batter) throw new GameError('Missing players in send context');

  if (!send) {
    if (isTagUp) {
      creditPlateAppearance(state, 'out');
      recordOut(
        state,
        events,
        `${thrower?.name ?? 'The defense'} hangs on — ${batter.name} is out and ${runner.name} holds ${baseName(runner.base ?? 1)}.`,
        batter.id,
        offense.side,
      );
    } else {
      applyAdvancesForHit(state, events, batter, hitAdvance(ctx.hitKind));
    }
    if (state.phase === 'live') maybeWalkOff(state, events);
    if (state.phase === 'live') finishPlateAppearance(state, events);
    return events;
  }

  // ---- the send / tag-up roll ----
  const rules = rulesOf(state);
  const runnerSeason = seasonForPlayer(state, runner);
  const rMod = sbMod(runnerSeason.sb, rules.sbBands) + advantage;
  let rRoll = rng.d6();
  if (rules.sendRerollOnes) {
    let guard = 0;
    while (rRoll === 1 && guard < 10) {
      rRoll = rng.d6();
      guard += 1;
    }
  }
  const rTotal = rRoll + rMod;

  const tMod = thrower ? fieldingRating(thrower, thrower.fieldPosition ?? 'C') : 0;
  const tRoll = thrower ? rng.d6() : 6;
  const tTotal = tRoll + tMod;

  const rolls = [
    roll(
      `${runner.name} (running)`,
      6,
      rRoll,
      rMod,
      `${runnerSeason.sb} SB ${fmtMod(sbMod(runnerSeason.sb, rules.sbBands))}${advantage ? `, ball ${advantage > 0 ? 'red' : 'blue'} ${fmtMod(advantage)}` : ''}`,
    ),
    roll(`${thrower?.name ?? 'The throw'} (throwing)`, 6, tRoll, tMod, thrower ? `${thrower.fieldPosition} rating` : ''),
  ];

  if (isTagUp) {
    // A run that scores on the catch is a sacrifice fly: no at-bat charged.
    creditPlateAppearance(state, toBase >= 4 && rTotal >= tTotal ? 'sac-fly' : 'out');
    recordOut(
      state,
      events,
      `${thrower?.name ?? 'The defense'} makes the catch — ${batter.name} is out. Score it ${thrower ? `F${POSITION_NUMBERS[thrower.fieldPosition ?? 'CF']}` : 'F'}.`,
      batter.id,
      offense.side,
    );
  } else {
    applyAdvancesForHit(state, events, batter, hitAdvance(ctx.hitKind));
  }

  if (state.phase !== 'live') {
    // Walk-off during the trailing advances — stop everything.
    events.push(pushEvent(state, { kind: 'send', text: `${runner.name} — the game is over!`, rolls }));
    return events;
  }

  if (rTotal >= tTotal) {
    // Tie goes to the runner.
    if (toBase >= 4) {
      scoreRun(state, runner, events);
    } else {
      runner.base = toBase as 1 | 2 | 3;
    }
    events.push(
      pushEvent(state, {
        kind: 'send',
        text: `${rTotal} beats ${tTotal} — ${runner.name} ${isTagUp ? 'tags up and takes' : 'is sent for'} ${baseName(Math.min(toBase, 4))}!`,
        rolls,
        refs: { playerId: runner.id, base: toBase },
      }),
    );
  } else {
    runner.base = null;
    recordOut(
      state,
      events,
      `${tTotal} nails him at ${baseName(Math.min(toBase, 4))}! ${runner.name} is out (${rTotal} vs ${tTotal}).`,
      runner.id,
      offense.side,
    );
  }

  if (state.phase === 'live') maybeWalkOff(state, events);
  if (state.phase === 'live') finishPlateAppearance(state, events);
  return events;
}

// ---------------------------------------------------------------------------
// Advancement
// ---------------------------------------------------------------------------

function hitAdvance(hitKind: PlayContext['hitKind']): number {
  if (!hitKind) return 1;
  return { single: 1, double: 2, triple: 3, 'home-run': 4 }[hitKind];
}

/** Default advancement: every runner takes as many bases as the batter. */
export function applyAdvancesForHit(
  state: GameState,
  events: GameEvent[],
  batter: EnginePlayer,
  advance: number,
): void {
  const offense = getOffense(state);
  const runners = offense.players
    .filter((p) => p.base !== null)
    .sort((a, b) => (b.base ?? 0) - (a.base ?? 0));
  // On a home run every run counts, even in a walk-off; otherwise play stops at the winning run.
  const isHomeRun = advance >= 4;

  for (const runner of runners) {
    const to = (runner.base ?? 0) + advance;
    if (to >= 4) {
      scoreRun(state, runner, events);
      if (!isHomeRun && maybeWalkOff(state, events)) return;
    } else {
      runner.base = to as 1 | 2 | 3;
    }
  }

  if (isHomeRun) {
    scoreRun(state, batter, events);
  } else {
    batter.base = advance as 1 | 2 | 3;
  }
  maybeWalkOff(state, events);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defenderIsOutfielder(player: EnginePlayer): boolean {
  return player.fieldPosition === 'LF' || player.fieldPosition === 'CF' || player.fieldPosition === 'RF';
}

function baseName(base: number): string {
  return { 1: 'first', 2: 'second', 3: 'third', 4: 'home' }[Math.min(base, 4)] ?? '?';
}

function scoringNotation(defender: EnginePlayer, contactType: string): string {
  const pos = defender.fieldPosition ?? 'C';
  const num = POSITION_NUMBERS[pos];
  if (contactType === 'pop-up' || contactType === 'fly' || contactType === 'deep-fly' || contactType === 'line-drive') {
    return `F${num}`;
  }
  return `${num}-3`;
}

/**
 * After the lead forced runner is retired, everyone behind him in the force
 * chain moves up one base. The lead force is always the highest occupied
 * base in the chain, so nobody scores this way.
 */
function advanceTrailingForcedRunners(state: GameState, forcedBase: number): void {
  const offense = getOffense(state);
  for (let b = forcedBase - 1; b >= 1; b--) {
    const runner = offense.players.find((p) => p.base === b);
    if (runner) runner.base = (b + 1) as 1 | 2 | 3;
  }
}

function dpNotation(defender: EnginePlayer): string {
  const pos = defender.fieldPosition ?? 'SS';
  const num = POSITION_NUMBERS[pos];
  const pivot = pos === '2B' || pos === '1B' ? '6' : '4';
  return `${num}-${pivot}-3`;
}

/** Fielder + pivot + first baseman, per the rules' example (6-4-3). */
function dpInvolvedDefenders(state: GameState, fielder: EnginePlayer): EnginePlayer[] {
  const defense = getDefense(state);
  const result: EnginePlayer[] = [fielder];
  const pos = fielder.fieldPosition ?? 'SS';
  let pivotPos: Position | null = null;
  if (pos === 'SS' || pos === '3B') pivotPos = '2B';
  else if (pos === '2B' || pos === '1B') pivotPos = 'SS';
  if (pivotPos) {
    const pivot = defense.players.find((p) => p.id !== fielder.id && p.status === 'active' && p.fieldPosition === pivotPos);
    if (pivot) result.push(pivot);
  }
  const firstBase = defense.players.find((p) => p.id !== fielder.id && p.status === 'active' && p.fieldPosition === '1B');
  if (firstBase) result.push(firstBase);
  return result;
}

/** Pre-decision odds preview for the UI. */
function dpFactorPreview(state: GameState, ctx: PlayContext): { diff: number; fielding: number; batterSb: number } {
  const defense = getDefense(state);
  const offense = getOffense(state);
  const defender = defense.players.find((p) => p.id === ctx.defenderId);
  const batter = offense.players.find((p) => p.id === ctx.batterId);
  if (!defender || !batter) return { diff: 0, fielding: 0, batterSb: 0 };
  const diff = (ctx.defenseRoll ?? 0) - ctx.contactRoll;
  const fielding = dpInvolvedDefenders(state, defender).reduce(
    (sum, p) => sum + fieldingRating(p, p.fieldPosition ?? 'C'),
    0,
  );
  const batterSeason = seasonForPlayer(state, batter);
  return { diff, fielding, batterSb: sbMod(batterSeason.sb, rulesOf(state).sbBands) };
}
