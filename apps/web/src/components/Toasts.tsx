/**
 * The "filed it" cue.
 *
 * Adding a card, or taking one in a draft, fires a small card that slides in
 * from the corner and fades on its own. The container ignores pointer events
 * and nothing here awaits the animation, so a fast clicker can keep going.
 */

import { useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { RARITY_LABEL, rarityRank } from '@cardball/shared';
import type { DraftRarity } from '@cardball/shared';

export interface CardToast {
  id: number;
  /** "Willie Mays 1965" */
  title: string;
  /** where it landed, e.g. "filed in your collection" */
  detail: string;
  rarity: DraftRarity;
  headline: string;
  year: number | null;
  href?: string;
}

type ToastInput = Omit<CardToast, 'id'> & { ttl?: number };

let nextId = 1;
let toasts: CardToast[] = [];
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => toasts;

/** Show a cue. Returns the id, useful for tests. */
export function pushCardToast({ ttl = 3600, ...input }: ToastInput): number {
  const toast: CardToast = { ...input, id: nextId++ };
  // Keep only the last few; a dropped cue's own timer fires harmlessly.
  toasts = [...toasts, toast].slice(-4);
  for (const listener of listeners) listener();
  setTimeout(() => dismissCardToast(toast.id), ttl);
  return toast.id;
}

export function dismissCardToast(id: number) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  for (const listener of listeners) listener();
}

const TIER_STOCK: Record<DraftRarity, string> = {
  common: 'from-[#e6dcc3] to-[#cfc4a6]',
  uncommon: 'from-[#cfe3d5] to-[#a9c4b4]',
  rare: 'from-[#c3d6f2] to-[#93b0dd]',
  star: 'from-[#f6e2a8] to-[#dfb14a]',
  mythic: 'from-[#e79ab4] to-[#8a5fc4]',
};

/** The foil class each tier wears on its mini card, matching the full card. */
const TIER_FOIL: Partial<Record<DraftRarity, string>> = { rare: 'foil-rare', star: 'foil-star', mythic: 'foil-mythic' };

/** The little card that flies in: card stock, team stripes, and foil if it earns it. */
function MiniCard({ toast }: { toast: CardToast }) {
  return (
    <span className="relative block h-14 w-10 shrink-0 overflow-hidden rounded-[4px] ring-1 ring-black/40">
      <span className={`absolute inset-0 bg-gradient-to-b ${TIER_STOCK[toast.rarity]}`} />
      <span className="absolute inset-x-0 top-0 h-3.5 bg-field-deep/85" />
      <span className="absolute inset-x-1 top-4 h-3 rounded-[2px] bg-white/55" />
      <span className="absolute inset-x-1 top-8 space-y-px">
        <span className="block h-1 rounded-full bg-ink/25" />
        <span className="block h-1 w-2/3 rounded-full bg-ink/20" />
      </span>
      <span className="absolute inset-x-0 bottom-0 h-2.5 bg-crimson/70" />
      {TIER_FOIL[toast.rarity] ? <span className={`${TIER_FOIL[toast.rarity]} pointer-events-none absolute inset-0`} /> : null}
    </span>
  );
}

/** Mount once, near the root. */
export function CardToaster() {
  const live = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-80"
    >
      <AnimatePresence initial={false}>
        {live.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            className={`panel pointer-events-auto flex w-full items-center gap-3 px-3 py-2.5 ${
              rarityRank(toast.rarity) >= rarityRank('rare') ? 'ring-1 ring-gold/35' : ''
            }`}
          >
            <motion.span
              initial={{ rotate: -14, y: 6 }}
              animate={{ rotate: 0, y: 0 }}
              transition={{ type: 'spring', stiffness: 340, damping: 20 }}
              className="shrink-0"
            >
              <MiniCard toast={toast} />
            </motion.span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-sm font-semibold text-chalk">
                {toast.title}
                {toast.year ? <span className="ml-1 font-mono text-xs font-normal text-chalk/50">{toast.year}</span> : null}
              </span>
              <span className="block truncate text-xs text-chalk/60">{toast.detail}</span>
              <span className="mt-0.5 flex items-center gap-1.5">
                <span className="rounded-full bg-white/10 px-1.5 py-px text-[10px] font-bold tracking-wider text-chalk/75 uppercase">
                  {RARITY_LABEL[toast.rarity]}
                </span>
                <span className="truncate font-mono text-[11px] text-chalk/50">{toast.headline}</span>
              </span>
              {toast.href ? (
                <Link to={toast.href} className="mt-1 inline-block text-[11px] text-gold underline">
                  Open collection
                </Link>
              ) : null}
            </span>
            <button
              type="button"
              aria-label="Dismiss"
              className="self-start rounded-full px-1.5 text-chalk/40 transition-colors hover:text-chalk"
              onClick={() => dismissCardToast(toast.id)}
            >
              ×
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
