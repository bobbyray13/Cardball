import { useEffect, useRef } from 'react';
import type { GameEvent } from '@cardball/engine';
import { DiceRow } from './Dice.js';

const KIND_STYLE: Record<string, string> = {
  run: 'border-l-gold',
  hit: 'border-l-gold',
  'home-run': 'border-l-gold',
  out: 'border-l-chalk/25',
  strikeout: 'border-l-chalk/25',
  'dp-made': 'border-l-chalk/25',
  'dp-failed': 'border-l-chalk/25',
  walk: 'border-l-navy',
  steal: 'border-l-navy',
  injury: 'border-l-crimson',
  concede: 'border-l-crimson',
  'game-over': 'border-l-gold',
  'half-end': 'border-l-white/15',
  'inning-start': 'border-l-white/15',
  'year-roll': 'border-l-white/10',
  pitch: 'border-l-white/10',
};

/** Scorer's-book play by play. Newest at the bottom, and it follows along. */
export function PlayByPlay({ events, className = '' }: { events: GameEvent[]; className?: string }) {
  const end = useRef<HTMLDivElement>(null);
  const lastSeq = events.at(-1)?.seq ?? 0;

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lastSeq]);

  return (
    <div className={`max-h-[28rem] space-y-1.5 overflow-y-auto pr-1 ${className}`}>
      {events.length === 0 ? <p className="py-6 text-center text-sm text-chalk/45">The first pitch is coming up.</p> : null}
      {events.map((event) => (
        <article
          key={event.seq}
          className={`rounded-r-lg border-l-2 bg-black/20 px-3 py-2 ${KIND_STYLE[event.kind] ?? 'border-l-white/15'} ${
            event.kind === 'run' || event.kind === 'hit' || event.kind === 'game-over' ? 'bg-gold/10' : ''
          }`}
        >
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 font-mono text-[10px] text-chalk/35">
              {event.half === 'top' ? '▲' : '▼'}
              {event.inning}
            </span>
            <p className="text-sm text-chalk/85">{event.text}</p>
          </div>
          {event.rolls && event.rolls.length > 0 ? (
            <div className="mt-2 pl-6">
              <DiceRow rolls={event.rolls} />
            </div>
          ) : null}
        </article>
      ))}
      <div ref={end} />
    </div>
  );
}
