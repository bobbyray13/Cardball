import type { GameEvent, GameState } from '@cardball/engine';
import { formatIp } from '@cardball/engine';

/**
 * Line score, built from the play-by-play.
 *
 * The engine keeps only running totals, so the inning-by-inning grid is derived
 * from the `run` events, and hits from the `hit` events. Top halves belong to the
 * away team.
 */
export function LineScore({ state, events }: { state: GameState; events: GameEvent[] }) {
  const innings = Math.max(state.inning, state.config.regulationInnings);
  const away = new Array<number>(innings).fill(0);
  const home = new Array<number>(innings).fill(0);

  for (const event of events) {
    if (event.kind !== 'run') continue;
    const index = event.inning - 1;
    if (index < 0 || index >= innings) continue;
    const bucket = event.half === 'top' ? away : home;
    bucket[index] = (bucket[index] ?? 0) + (event.refs?.runCount ?? 1);
  }

  const hitsFor = (half: 'top' | 'bottom') => events.filter((e) => e.kind === 'hit' && e.half === half).length;

  const pitchers = (side: 'home' | 'away') =>
    state[side].players.filter((p) => p.outsPitched > 0).sort((a, b) => b.outsPitched - a.outsPitched);

  const row = (name: string, runs: number[], half: 'top' | 'bottom', total: number) => (
    <tr className="border-t border-white/10">
      <th scope="row" className="py-1 pr-3 text-left font-medium text-chalk">
        {name}
      </th>
      {runs.map((runsInInning, i) => (
        <td key={i} className="px-1.5 py-1 text-right font-mono tabular-nums text-chalk/70">
          {runsInInning || '·'}
        </td>
      ))}
      <td className="px-1.5 py-1 text-right font-mono font-bold tabular-nums text-chalk">{total}</td>
      <td className="px-1.5 py-1 text-right font-mono tabular-nums text-chalk/70">{hitsFor(half)}</td>
    </tr>
  );

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-72 text-sm">
          <thead>
            <tr className="text-[10px] tracking-wide text-chalk/45 uppercase">
              <th className="pr-3 text-left">Team</th>
              {Array.from({ length: innings }, (_, i) => (
                <th key={i} className="px-1.5 text-right font-mono">
                  {i + 1}
                </th>
              ))}
              <th className="px-1.5 text-right">R</th>
              <th className="px-1.5 text-right">H</th>
            </tr>
          </thead>
          <tbody>
            {row(state.away.name, away, 'top', state.away.score)}
            {row(state.home.name, home, 'bottom', state.home.score)}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(['away', 'home'] as const).map((side) => (
          <div key={side} className="rounded-xl border border-white/10 bg-black/20 p-3">
            <h3 className="mb-2 font-display text-sm font-semibold text-chalk">{state[side].name} pitching</h3>
            {pitchers(side).length === 0 ? (
              <p className="text-xs text-chalk/45">Nobody has taken the mound yet.</p>
            ) : (
              <ul className="space-y-1 font-mono text-xs">
                {pitchers(side).map((p) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-chalk/80">{p.name}</span>
                    <span className="shrink-0 text-chalk/50">
                      {formatIp(p.outsPitched)} IP{p.pitchingRole ? ` · ${p.pitchingRole}` : ''}
                      {p.injured ? ' · injured' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
