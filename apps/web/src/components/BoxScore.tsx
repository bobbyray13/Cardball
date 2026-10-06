import { memo } from 'react';
import type { EnginePlayer, GameState, Side } from '@cardball/engine';
import { inningsLabel } from '@cardball/shared';
import type { ZoomPlayer } from './Field.js';

/**
 * The box score, straight from the engine's running tally: batters in
 * lineup order with substitutes under the man they replaced, then pitchers
 * in the order they took the mound.
 */
export const BoxScore = memo(function BoxScore({ state, onZoom }: { state: GameState; onZoom?: ZoomPlayer }) {
  if (!state.box) {
    return <p className="text-sm text-chalk/50">This game was played before box scores were kept.</p>;
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {(['away', 'home'] as const).map((side) => (
        <TeamBoxScore key={side} state={state} side={side} onZoom={onZoom} />
      ))}
    </div>
  );
});

function TeamBoxScore({ state, side, onZoom }: { state: GameState; side: Side; onZoom?: ZoomPlayer | undefined }) {
  const team = state[side];
  const box = state.box![side];
  const player = (id: string) => team.players.find((p) => p.id === id);

  const batters = Object.entries(box.batting)
    .map(([id, line]) => ({ player: player(id), line }))
    .filter((b): b is { player: EnginePlayer; line: (typeof b)['line'] } => b.player !== undefined)
    .sort((a, b) => a.line.spot - b.line.spot || a.line.order - b.line.order);
  const pitchers = Object.entries(box.pitching)
    .map(([id, line]) => ({ player: player(id), line }))
    .filter((p): p is { player: EnginePlayer; line: (typeof p)['line'] } => p.player !== undefined)
    .sort((a, b) => a.line.order - b.line.order);

  const total = batters.reduce(
    (t, { line }) => ({ ab: t.ab + line.ab, r: t.r + line.r, h: t.h + line.h, rbi: t.rbi + line.rbi, bb: t.bb + line.bb, k: t.k + line.k }),
    { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, k: 0 },
  );

  const notes = (label: string, pick: (l: (typeof batters)[number]['line']) => number) => {
    const names = batters.filter((b) => pick(b.line) > 0).map((b) => `${shortName(b.player.name)}${pick(b.line) > 1 ? ` ${pick(b.line)}` : ''}`);
    return names.length ? `${label}: ${names.join(', ')}` : null;
  };
  const footnotes = [notes('2B', (l) => l.doubles), notes('3B', (l) => l.triples), notes('HR', (l) => l.hr), notes('SB', (l) => l.sb), notes('CS', (l) => l.cs), notes('SF', (l) => l.sf)].filter(
    (n): n is string => n !== null,
  );

  const seen = new Set<number>();
  const name = (p: EnginePlayer, sub: boolean) => (
    <button
      type="button"
      disabled={!onZoom}
      onClick={onZoom ? () => onZoom(side, p) : undefined}
      className={`max-w-[11rem] truncate text-left enabled:hover:text-gold ${sub ? 'pl-3 text-chalk/70' : 'text-chalk'}`}
    >
      {p.name}
    </button>
  );

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-3">
      <h3 className="font-display text-sm font-semibold text-chalk">{team.name}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] tracking-wide text-chalk/45 uppercase">
              <th className="text-left">Batting</th>
              {['AB', 'R', 'H', 'RBI', 'BB', 'K'].map((h) => (
                <th key={h} className="w-8 text-right">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {batters.map(({ player: p, line }) => {
              const sub = seen.has(line.spot);
              seen.add(line.spot);
              return (
                <tr key={p.id} className="border-t border-white/5">
                  <td className="py-0.5 font-sans">
                    <span className="flex items-baseline gap-1.5">
                      {name(p, sub)}
                      <span className="text-[10px] text-chalk/40">{line.position ?? p.fieldPosition ?? ''}</span>
                    </span>
                  </td>
                  {[line.ab, line.r, line.h, line.rbi, line.bb, line.k].map((n, i) => (
                    <td key={i} className={`text-right ${n ? 'text-chalk' : 'text-chalk/35'}`}>
                      {n}
                    </td>
                  ))}
                </tr>
              );
            })}
            <tr className="border-t border-white/20 font-semibold">
              <td className="py-0.5 font-sans text-chalk/70">Totals</td>
              {[total.ab, total.r, total.h, total.rbi, total.bb, total.k].map((n, i) => (
                <td key={i} className="text-right text-chalk">
                  {n}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {footnotes.length ? <p className="font-mono text-[11px] leading-relaxed text-chalk/55">{footnotes.join(' · ')}</p> : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] tracking-wide text-chalk/45 uppercase">
              <th className="text-left">Pitching</th>
              {['IP', 'H', 'R', 'ER', 'BB', 'K', 'HR'].map((h) => (
                <th key={h} className="w-8 text-right">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {pitchers.map(({ player: p, line }) => (
              <tr key={p.id} className="border-t border-white/5">
                <td className="py-0.5 font-sans">{name(p, false)}</td>
                <td className="text-right text-chalk">{inningsLabel(line.outs)}</td>
                {[line.h, line.r, line.r, line.bb, line.k, line.hr].map((n, i) => (
                  <td key={i} className={`text-right ${n ? 'text-chalk' : 'text-chalk/35'}`}>
                    {n}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const shortName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? (parts[parts.length - 1] ?? name) : name;
};
