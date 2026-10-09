import { useMemo, useState } from 'react';
import type { GameState, Side } from '@cardball/engine';
import {
  availablePitchers,
  benchHitters,
  fatigueInnings,
  fmtMod,
  getOffense,
  getTeam,
  pitcherTotalMod,
  runnersOn,
} from '@cardball/engine';
import type { GameAction, Position } from '@cardball/shared';
import { Button, Notice } from './ui.js';

/**
 * The bench, during a game.
 *
 * Substitutions are legal any time between pitches, so a manager can pinch-hit,
 * pinch-run, swap a glove, or change pitchers without waiting for a forced
 * decision. Everything here sends the same `substitute` / `pitcher-change`
 * actions the engine already validates; an illegal move comes back as a
 * readable error and lands as a toast.
 */
export function BenchPanel({
  state,
  side,
  onAction,
  busy,
}: {
  state: GameState;
  side: Side;
  onAction: (action: GameAction) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const team = getTeam(state, side);
  const offense = getOffense(state);

  const pitcher = team.players.find((p) => p.id === team.activePitcherId) ?? null;
  const bullpen = availablePitchers(state, side);
  const bench = benchHitters(team);
  const myTurnAtBat = offense.side === side;
  const dueBatterId = myTurnAtBat ? (state.currentPa?.batterId ?? null) : null;
  const runners = myTurnAtBat ? runnersOn(team) : [];
  const fielders = team.players.filter((p) => p.status === 'active' && p.lineupSpot !== null && p.fieldPosition !== null);

  const [inPitcherId, setInPitcherId] = useState('');
  const [pinchHitterId, setPinchHitterId] = useState('');
  const [pinchRunnerFor, setPinchRunnerFor] = useState('');
  const [pinchRunnerId, setPinchRunnerId] = useState('');
  const [outFielderId, setOutFielderId] = useState('');
  const [inFielderId, setInFielderId] = useState('');
  const [subPosition, setSubPosition] = useState('');

  const pit = pitcher ? pitcherTotalMod(state, pitcher) : null;
  const fatigued = pitcher ? fatigueInnings(state, pitcher) : 0;

  const nameOf = (id: string) => team.players.find((p) => p.id === id)?.name ?? id;

  const runnerFor = useMemo(() => runners.find((r) => r.id === pinchRunnerFor) ?? null, [runners, pinchRunnerFor]);

  if (team.players.every((p) => p.status !== 'bench')) {
    return <Notice>No bench left for {team.name}.</Notice>;
  }

  return (
    <div className="rounded-xl border border-white/10 bg-black/20">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-chalk">Bench · {team.name}</span>
          <span className="block truncate font-mono text-xs text-chalk/50">
            {pitcher ? (
              <>
                {pitcher.name} on the mound · PIT {pit ? fmtMod(pit.mod) : '—'}
                {fatigued > 0 ? ` · ${fatigued} tired inning${fatigued === 1 ? '' : 's'}` : ''}
              </>
            ) : (
              'nobody on the mound'
            )}
          </span>
        </span>
        <span className="shrink-0 text-xs text-chalk/50">{open ? 'Hide' : 'Open'}</span>
      </button>

      {open ? (
        <div className="space-y-4 border-t border-white/10 p-3">
          {/* ---- change pitcher ---- */}
          <div>
            <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-chalk/50 uppercase">Change pitcher</p>
            {bullpen.length === 0 ? (
              <p className="text-xs text-chalk/45">Nobody left in the bullpen.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <select className="min-w-0 flex-1 rounded-lg border border-white/25 bg-dugout-light px-3 py-2 text-sm text-chalk" value={inPitcherId} onChange={(e) => setInPitcherId(e.target.value)}>
                  <option value="">Pick a pitcher…</option>
                  {bullpen.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.cardYear}) · {p.pitcherClass}
                    </option>
                  ))}
                </select>
                <Button
                  disabled={!inPitcherId || busy}
                  onClick={() => onAction({ type: 'pitcher-change', inPlayerId: inPitcherId })}
                >
                  Bring him in
                </Button>
              </div>
            )}
          </div>

          {/* ---- pinch hit ---- */}
          {myTurnAtBat && dueBatterId ? (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-chalk/50 uppercase">
                Pinch hit for {nameOf(dueBatterId)}
              </p>
              {bench.length === 0 ? (
                <p className="text-xs text-chalk/45">No bats on the bench.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <select className="min-w-0 flex-1 rounded-lg border border-white/25 bg-dugout-light px-3 py-2 text-sm text-chalk" value={pinchHitterId} onChange={(e) => setPinchHitterId(e.target.value)}>
                    <option value="">Pick a hitter…</option>
                    {bench.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.cardYear}) · {p.positions.join(' ')}
                      </option>
                    ))}
                  </select>
                  <Button
                    disabled={!pinchHitterId || busy}
                    onClick={() => onAction({ type: 'substitute', outPlayerId: dueBatterId, inPlayerId: pinchHitterId })}
                  >
                    Send him up
                  </Button>
                </div>
              )}
            </div>
          ) : null}

          {/* ---- pinch run ---- */}
          {runners.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-chalk/50 uppercase">Pinch run</p>
              <div className="flex flex-wrap gap-2">
                <select className="min-w-0 flex-1 rounded-lg border border-white/25 bg-dugout-light px-3 py-2 text-sm text-chalk" value={pinchRunnerFor} onChange={(e) => setPinchRunnerFor(e.target.value)}>
                  <option value="">Pick a runner…</option>
                  {runners.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · on {r.base === 1 ? 'first' : r.base === 2 ? 'second' : 'third'}
                    </option>
                  ))}
                </select>
                <select className="min-w-0 flex-1 rounded-lg border border-white/25 bg-dugout-light px-3 py-2 text-sm text-chalk" value={pinchRunnerId} onChange={(e) => setPinchRunnerId(e.target.value)}>
                  <option value="">Pick a burner…</option>
                  {bench
                    .filter((p) => p.id !== runnerFor?.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.cardYear})
                      </option>
                    ))}
                </select>
                <Button
                  disabled={!pinchRunnerFor || !pinchRunnerId || busy}
                  onClick={() => onAction({ type: 'substitute', outPlayerId: pinchRunnerFor, inPlayerId: pinchRunnerId })}
                >
                  Send him in
                </Button>
              </div>
            </div>
          ) : null}

          {/* ---- defensive sub ---- */}
          {fielders.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-chalk/50 uppercase">Defensive sub</p>
              <div className="flex flex-wrap gap-2">
                <select className="min-w-0 flex-1 rounded-lg border border-white/25 bg-dugout-light px-3 py-2 text-sm text-chalk" value={outFielderId} onChange={(e) => setOutFielderId(e.target.value)}>
                  <option value="">Take out…</option>
                  {fielders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.fieldPosition}
                    </option>
                  ))}
                </select>
                <select className="min-w-0 flex-1 rounded-lg border border-white/25 bg-dugout-light px-3 py-2 text-sm text-chalk" value={inFielderId} onChange={(e) => setInFielderId(e.target.value)}>
                  <option value="">Send in…</option>
                  {bench.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.cardYear}) · {p.positions.join(' ')}
                    </option>
                  ))}
                </select>
                <select className="rounded-lg border border-white/25 bg-dugout-light px-3 py-2 text-sm text-chalk" value={subPosition} onChange={(e) => setSubPosition(e.target.value)}>
                  <option value="">keep his spot</option>
                  {(['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'] as Position[]).map((pos) => (
                    <option key={pos} value={pos}>
                      at {pos}
                    </option>
                  ))}
                </select>
                <Button
                  disabled={!outFielderId || !inFielderId || busy}
                  onClick={() =>
                    onAction({
                      type: 'substitute',
                      outPlayerId: outFielderId,
                      inPlayerId: inFielderId,
                      ...(subPosition ? { fieldPosition: subPosition as Position } : {}),
                    })
                  }
                >
                  Make the move
                </Button>
              </div>
            </div>
          ) : null}

          <p className="text-[11px] text-chalk/40">
            A pinch-hitter takes the due batter's spot; a pinch-runner takes a runner's; the pitcher is changed on the mound.
            Moves are legal any time between pitches.
          </p>
        </div>
      ) : null}
    </div>
  );
}
