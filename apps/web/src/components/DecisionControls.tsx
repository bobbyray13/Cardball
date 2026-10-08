import { memo } from 'react';
import { motion } from 'framer-motion';
import type { EnginePlayer, GameState, RollDetail, Side } from '@cardball/engine';
import {
  availablePitchers,
  benchHitters,
  canSteal,
  fmtMod,
  getDefense,
  getOffense,
  getTeam,
  runnerSbMod,
  runnersOn,
  seasonForPlayer,
} from '@cardball/engine';
import type { GameAction } from '@cardball/shared';
import { Die } from './Dice.js';
import { Button, Notice } from './ui.js';

/**
 * Everything the manager on the clock can do.
 *
 * The engine pauses on forced decisions (double-play gamble, sending a runner,
 * choosing a new pitcher, replacing an injured player). When it is not paused,
 * the offense throws the next pitch and may send a runner.
 */
export const DecisionControls = memo(function DecisionControls({
  state,
  mySides,
  onAction,
  busy,
}: {
  state: GameState;
  mySides: Side[];
  onAction: (action: GameAction) => void;
  busy: boolean;
}) {
  if (mySides.length === 0) {
    return <Notice>You are watching this one from the stands.</Notice>;
  }

  const pending = state.pendingDecision;
  const offense = getOffense(state);
  const defense = getDefense(state);

  if (pending) {
    if (pending.kind === 'batter-roll') {
      if (!mySides.includes(pending.side)) {
        return <Waiting name={getTeam(state, pending.side).name} prompt={pending.prompt} />;
      }
      // The pitcher's die stays on the table beside the button, tumbling in
      // with the button and then settling back after a few seconds.
      const { pitcherRoll, pitcherTotal } = pending.detail ?? {};
      const pitcherDie: RollDetail | null =
        pitcherRoll !== undefined && pitcherTotal !== undefined
          ? { label: 'Pitcher', sides: 6, value: pitcherRoll, modifier: pitcherTotal - pitcherRoll, total: pitcherTotal }
          : null;
      return (
        <div className="space-y-3">
          <p className="text-sm text-chalk/70">{pending.prompt}</p>
          <div className="flex flex-wrap items-center gap-4">
            {pitcherDie ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 1, 0.35] }}
                transition={{ duration: 4.5, times: [0, 0.06, 0.72, 1] }}
              >
                <Die roll={pitcherDie} accent />
              </motion.div>
            ) : null}
            <Button variant="primary" disabled={busy} onClick={() => onAction({ type: 'roll-bat' })}>
              {busy ? 'Rolling…' : 'Roll the bat'}
            </Button>
          </div>
        </div>
      );
    }
    if (!mySides.includes(pending.side)) {
      return <Waiting name={getTeam(state, pending.side).name} prompt={pending.prompt} />;
    }
    return <ForcedDecision state={state} onAction={onAction} busy={busy} />;
  }

  if (state.currentPa) {
    // Paced pitching: the defense throws the pitcher's die, then the offense
    // rolls the bat. Otherwise the offense resolves the whole roll.
    const throwerSide = state.config.pacedPitch ? defense.side : offense.side;
    if (!mySides.includes(throwerSide)) {
      const name = state.config.pacedPitch ? defense.name : offense.name;
      const prompt = state.config.pacedPitch ? `${defense.name} are on the mound.` : `${offense.name} are at bat.`;
      return <Waiting name={name} prompt={prompt} />;
    }
    const onBase = state.config.pacedPitch ? [] : runnersOn(offense).filter((runner) => canSteal(state, runner.id).ok);
    return (
      <div className="space-y-3">
        <p className="text-sm text-chalk/70">
          {state.config.pacedPitch
            ? `${defense.players.find((p) => p.id === defense.activePitcherId)?.name ?? 'The pitcher'} deals to ${batterName(state)}.`
            : `${batterName(state)} is due up against ${defense.players.find((p) => p.id === defense.activePitcherId)?.name ?? 'the pitcher'}.`}
          {state.currentPa.balls > 0 ? <span className="ml-1 text-gold">{state.currentPa.balls} tied roll{state.currentPa.balls > 1 ? 's' : ''} — one more is a walk.</span> : null}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onClick={() => onAction({ type: 'throw-pitch' })}>
            {busy ? 'Rolling…' : 'Throw the pitch'}
          </Button>
          {onBase.map((runner) => (
            <Button key={runner.id} disabled={busy} onClick={() => onAction({ type: 'attempt-steal', runnerId: runner.id })}>
              Send {lastName(runner.name)} (SB {fmtMod(runnerSbMod(seasonForPlayer(state, runner), state.config.rules).mod)})
            </Button>
          ))}
        </div>
      </div>
    );
  }

  return <Notice>Waiting for the next play…</Notice>;
});

function Waiting({ name, prompt }: { name: string; prompt: string }) {
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-sm text-chalk/70">
        <span className="h-2 w-2 animate-pulse rounded-full bg-gold" />
        Waiting on {name}
      </p>
      <p className="text-xs text-chalk/45">{prompt}</p>
    </div>
  );
}

function ForcedDecision({ state, onAction, busy }: { state: GameState; onAction: (a: GameAction) => void; busy: boolean }) {
  const pending = state.pendingDecision!;
  const team = getTeam(state, pending.side);

  const bench = benchHitters(team);
  const bullpen = availablePitchers(state, pending.side);

  return (
    <div className="space-y-3">
      <p className="font-medium text-gold">{pending.prompt}</p>

      {pending.kind === 'dp-attempt' ? (
        <div className="space-y-2">
          {pending.detail?.dpFactors ? (
            <p className="font-mono text-xs text-chalk/50">
              grounder {fmtMod(pending.detail.dpFactors.diff)} · fielding {fmtMod(pending.detail.dpFactors.fielding)} · batter speed −
              {pending.detail.dpFactors.batterSb} · needs better than {state.config.rules.dpTarget}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => onAction({ type: 'dp-attempt', attempt: true })}>
              Turn two
            </Button>
            <Button disabled={busy} onClick={() => onAction({ type: 'dp-attempt', attempt: false })}>
              Take the sure out
            </Button>
          </div>
        </div>
      ) : null}

      {pending.kind === 'send-runner' ? (
        <div className="space-y-2">
          <p className="font-mono text-xs text-chalk/50">
            {pending.detail?.targetBase ? `heading for ${baseName(pending.detail.targetBase)}` : 'extra base'}
            {pending.detail?.runnerAdvantage ? ` · contact ${fmtMod(pending.detail.runnerAdvantage)}` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => onAction({ type: 'send-runner', send: true })}>
              Send him
            </Button>
            <Button disabled={busy} onClick={() => onAction({ type: 'send-runner', send: false })}>
              Hold him
            </Button>
          </div>
        </div>
      ) : null}

      {pending.kind === 'pitcher-change' ? (
        bullpen.length === 0 ? (
          <Notice>Nobody left in the bullpen.</Notice>
        ) : (
          <ul className="space-y-2">
            {bullpen.map((pitcher) => (
              <li key={pitcher.id}>
                <Button
                  className="w-full justify-between"
                  disabled={busy}
                  onClick={() => onAction({ type: 'pitcher-change', inPlayerId: pitcher.id })}
                >
                  <span>{pitcher.name}</span>
                  <span className="font-mono text-xs text-chalk/50">
                    {pitcher.cardYear} · {pitcher.pitcherClass}
                    {pitcher.outsPitched > 0 ? ` · ${pitcher.outsPitched} outs today` : ''}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {pending.kind === 'pinch-runner' || pending.kind === 'lineup-fill' ? (
        bench.length === 0 ? (
          <Notice>No bench players available.</Notice>
        ) : (
          <ul className="space-y-2">
            {bench.map((player) => (
              <li key={player.id}>
                <Button
                  className="w-full justify-between"
                  disabled={busy}
                  onClick={() =>
                    onAction({
                      type: 'substitute',
                      outPlayerId: pending.playerId!,
                      inPlayerId: player.id,
                      ...(pending.kind === 'lineup-fill' && player.fieldPosition ? { fieldPosition: player.fieldPosition } : {}),
                    })
                  }
                >
                  <span>{player.name}</span>
                  <span className="font-mono text-xs text-chalk/50">
                    {player.positions.join(' ') || 'bench'} · SB {fmtMod(runnerSbMod(seasonForPlayer(state, player), state.config.rules).mod)}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function batterName(state: GameState): string {
  const offense = getOffense(state);
  const batter = state.currentPa ? offense.players.find((p) => p.id === state.currentPa!.batterId) : undefined;
  return batter?.name ?? 'The next hitter';
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? (parts[parts.length - 1] ?? name) : name;
}

function baseName(base: number): string {
  return base === 4 ? 'home' : base === 3 ? 'third' : base === 2 ? 'second' : 'first';
}
