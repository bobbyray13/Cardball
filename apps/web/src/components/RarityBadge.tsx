import { RARITY_LABEL } from '@cardball/shared';
import type { DraftRarity } from '@cardball/shared';

/**
 * The printed tier, as a pill. Common and uncommon stay quiet; rare wears the
 * navy/sky of its foil; star goes gold; mythic gets the crimson-to-violet
 * shimmer of its card front, plus its own marks.
 */
const STYLES: Record<DraftRarity, string> = {
  common: 'bg-white/10 text-chalk/70',
  uncommon: 'bg-field-light/30 text-chalk',
  rare: 'bg-navy/60 text-sky-200',
  star: 'bg-gold/85 text-ink',
  mythic: 'bg-[linear-gradient(120deg,#c2284a,#7a3fb0)] text-chalk ring-1 ring-fuchsia-300/50',
};

/** The mark a tier carries on its badge, the way a foil card wears one. */
const MARK: Partial<Record<DraftRarity, string>> = { star: '★', mythic: '✦' };

export function RarityBadge({ rarity }: { rarity: DraftRarity }) {
  const mark = MARK[rarity];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${STYLES[rarity]}`}>
      {mark ? <span aria-hidden>{mark}</span> : null}
      {RARITY_LABEL[rarity]}
    </span>
  );
}
