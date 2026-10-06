import type { DraftRarity } from '@cardball/shared';

const STYLES: Record<DraftRarity, string> = {
  common: 'bg-white/10 text-chalk/70',
  uncommon: 'bg-field-light/30 text-chalk',
  rare: 'bg-navy/60 text-sky-200',
  chase: 'bg-gold text-ink',
};

export function RarityBadge({ rarity }: { rarity: DraftRarity }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${STYLES[rarity]}`}>{rarity}</span>
  );
}
