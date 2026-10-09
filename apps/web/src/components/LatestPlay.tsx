import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { GameEvent } from '@cardball/engine';
import { DiceRow } from './Dice.js';

/** Badge look per event kind: the moments that score read gold. */
const KIND_BADGE: Record<string, { label: string; className: string; accent: boolean }> = {
  run: { label: 'RUN', className: 'bg-gold/20 text-gold', accent: true },
  'home-run': { label: 'HOME RUN', className: 'bg-gold/25 text-gold', accent: true },
  hit: { label: 'HIT', className: 'bg-gold/15 text-gold', accent: true },
  achievement: { label: 'FEAT', className: 'bg-gold/30 text-gold', accent: true },
  'game-over': { label: 'FINAL', className: 'bg-gold/25 text-gold', accent: true },
  walk: { label: 'WALK', className: 'bg-navy/70 text-chalk', accent: false },
  steal: { label: 'STEAL', className: 'bg-navy/70 text-chalk', accent: false },
  send: { label: 'SEND', className: 'bg-navy/70 text-chalk', accent: false },
  injury: { label: 'INJURY', className: 'bg-crimson/80 text-chalk', accent: false },
  concede: { label: 'CONCEDE', className: 'bg-crimson/80 text-chalk', accent: false },
};

const badgeOf = (kind: string) => KIND_BADGE[kind] ?? { label: kind.replace('-', ' ').toUpperCase(), className: 'bg-white/10 text-chalk/70', accent: false };

/**
 * How long each event of a new play holds the strip before the next. Two full
 * seconds, so the call is followable at the table instead of flashing past.
 */
const REVEAL_MS = 2000;
/** The first beat of a fresh play answers the button quickly; the rest pace out. */
const FIRST_BEAT_MS = 400;
/** Longer than this since the last beat means the batch is over. */
const BATCH_GAP_MS = 1600;

/**
 * The reveal clock for a play-by-play ledger. A new play arrives as a batch
 * of events — pitch, contact, the throw, the call — and this paces them one
 * at a time, so the outcome lands with the same suspense as dice on a table.
 * The mat shares one clock: the broadcast strip, the ball on the field, and
 * the sounds all follow the same beat. Whatever is already on the ledger when
 * the page opens is old news and never replays.
 */
export function usePlayReveal(events: GameEvent[]): GameEvent | null {
  const [revealedSeq, setRevealedSeq] = useState<number | null>(null);
  const primed = useRef(false);
  const lastBeatAt = useRef(0);

  useEffect(() => {
    if (!primed.current) {
      primed.current = true;
      // Mat mounts only after the initial game snapshot is loaded. An empty
      // ledger is a real baseline too, so the first live event still gets a
      // reveal instead of being mistaken for old history.
      if (events.length > 0) setRevealedSeq(events[events.length - 1]!.seq);
    }
  }, [events]);

  const next = events.find((e) => revealedSeq === null || e.seq > revealedSeq) ?? null;
  const nextSeq = next?.seq;

  useEffect(() => {
    if (nextSeq === undefined) return;
    const midBatch = Date.now() - lastBeatAt.current < BATCH_GAP_MS;
    const timer = setTimeout(
      () => {
        lastBeatAt.current = Date.now();
        setRevealedSeq(nextSeq);
      },
      midBatch ? REVEAL_MS : FIRST_BEAT_MS,
    );
    return () => clearTimeout(timer);
  }, [nextSeq]);

  return revealedSeq === null ? null : (events.find((e) => e.seq === revealedSeq) ?? null);
}

/**
 * The broadcast line on the mat: the beat currently on the air, from
 * usePlayReveal. The full ledger lives in the play-by-play; this is the call.
 */
export function LatestPlay({ beat }: { beat: GameEvent | null }) {
  const showing = beat;

  return (
    <div className="mb-3 min-h-[3.25rem]" aria-live="polite">
      {showing ? (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={showing.seq}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2"
          >
            <div className="flex items-baseline gap-2">
              <p className={`flex min-w-0 items-baseline gap-2 text-sm ${badgeOf(showing.kind).accent ? 'text-gold' : 'text-chalk/85'}`}>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${badgeOf(showing.kind).className}`}
                >
                  {badgeOf(showing.kind).label}
                </span>
                <span className="min-w-0">{showing.text}</span>
              </p>
            </div>
            {showing.rolls && showing.rolls.length > 0 ? <DiceRow rolls={showing.rolls} accent={badgeOf(showing.kind).accent} /> : null}
          </motion.div>
        </AnimatePresence>
      ) : (
        <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-chalk/45">
          {beat === null ? 'The first pitch is coming up.' : '…'}
        </p>
      )}
    </div>
  );
}
