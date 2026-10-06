import { motion } from 'framer-motion';
import type { RollDetail } from '@cardball/engine';

/**
 * Dice, with the modifier math visible.
 *
 * A roll on the ball card is always "die + modifier vs die + modifier", so each
 * die shows its own pips or number, the modifier it carried, and the total the
 * comparison used.
 */
export function Die({ roll, delay = 0 }: { roll: RollDetail; delay?: number }) {
  return (
    <motion.div
      className="flex items-center gap-2"
      initial={{ opacity: 0, y: -10, rotate: -12 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 18, delay }}
    >
      <Face sides={roll.sides} value={roll.value} />
      {roll.modifier !== 0 ? (
        <span className="font-mono text-xs text-chalk/70">
          {roll.modifier > 0 ? `+${roll.modifier}` : roll.modifier}
          {roll.modifierNote ? <span className="ml-1 text-chalk/40">{roll.modifierNote}</span> : null}
        </span>
      ) : null}
      <span className="font-mono text-sm font-bold text-chalk">= {roll.total}</span>
    </motion.div>
  );
}

function Face({ sides, value }: { sides: 6 | 20; value: number }) {
  if (sides === 6) {
    return (
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-stock shadow-inner ring-1 ring-black/30" aria-label={`d6 showing ${value}`}>
        <Pips value={value} />
      </span>
    );
  }
  return (
    <span
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-navy font-mono text-sm font-bold text-chalk shadow-inner ring-1 ring-white/25"
      aria-label={`d20 showing ${value}`}
    >
      {value}
    </span>
  );
}

/** Standard pip layout on a 3×3 grid. */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Pips({ value }: { value: number }) {
  const on = new Set(PIPS[value] ?? []);
  return (
    <span className="grid grid-cols-3 grid-rows-3 gap-[1px]">
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={`h-[3px] w-[3px] rounded-full ${on.has(i) ? 'bg-ink' : 'bg-transparent'}`} />
      ))}
    </span>
  );
}

/** A row of dice for one event, revealed left to right. */
export function DiceRow({ rolls }: { rolls: RollDetail[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {rolls.map((roll, i) => (
        <div key={`${roll.label}-${i}`} className="flex flex-col gap-1">
          <span className="text-[10px] tracking-wide text-chalk/45 uppercase">{roll.label}</span>
          <Die roll={roll} delay={i * 0.12} />
        </div>
      ))}
    </div>
  );
}
