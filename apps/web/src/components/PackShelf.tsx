import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PACK_SOURCE_LABEL, faceLabel, packTheme, rarityRank, rateCard } from '@cardball/shared';
import type { CollectionCard, PackView } from '@cardball/shared';
import { api } from '../api.js';
import { BallCard } from './BallCard.js';
import { PackArt } from './PackArt.js';
import { pushCardToast } from './Toasts.js';
import { Button, EmptyState, ErrorNote, Panel, useAction, useLoad } from './ui.js';

/**
 * The pack shelf: sealed packs a manager has earned, ready to tear open. The
 * cards inside land straight in the collection, and the reveal is the moment.
 */
export function PackShelf({ onCardsFiled }: { onCardsFiled?: () => void }) {
  const packs = useLoad(() => api.packs(), []);
  const [revealed, setRevealed] = useState<{ pack: PackView; cards: CollectionCard[] } | null>(null);
  const open = useAction(async (pack: PackView) => {
    const result = await api.openPack(pack.id);
    setRevealed(result);
    packs.reload();
    onCardsFiled?.();
    // One cue for the pull, not one per card: the reveal shows them all.
    const best = [...result.cards].sort((a, b) => rarityRank(rateCard(b.card).rarity) - rarityRank(rateCard(a.card).rarity))[0];
    if (best) {
      const rating = rateCard(best.card);
      pushCardToast({
        title: best.card.name,
        detail: `Best of ${result.cards.length} from your ${packTheme(result.pack.themeId).name}`,
        rarity: rating.rarity,
        headline: rating.headline,
        year: best.card.cardYear,
        href: '/collection',
      });
    }
  });

  const sealed = (packs.data?.packs ?? []).filter((p) => p.openedAt === null);
  const opened = (packs.data?.packs ?? []).filter((p) => p.openedAt !== null).slice(0, 4);

  if (sealed.length === 0 && opened.length === 0) return null;

  return (
    <Panel
      title="Pack shelf"
      subtitle={sealed.length > 0 ? 'Tear one open — the cards land straight in your collection.' : 'Your shelf is empty. Win games and finish collections to earn packs.'}
    >
      <ErrorNote error={packs.error} />
      {sealed.length > 0 ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {sealed.map((pack) => (
            <li key={pack.id} className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-3">
              <PackArt theme={packTheme(pack.themeId)} size="md" />
              <p className="line-clamp-2 min-h-8 text-center text-xs font-medium text-chalk">{pack.label ?? PACK_SOURCE_LABEL[pack.source]}</p>
              <p className="font-mono text-[10px] text-chalk/45">
                {pack.size} cards · {pack.era.from}–{pack.era.to}
              </p>
              <Button size="sm" variant="primary" disabled={open.busy} onClick={() => void open.execute(pack)}>
                {open.busy ? 'Tearing…' : 'Tear it open'}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No sealed packs">
          Win a game, take a tournament, or finish a historic collection to earn more.
        </EmptyState>
      )}

      {opened.length > 0 ? (
        <div className="mt-4 border-t border-white/10 pt-3">
          <p className="mb-2 text-xs font-semibold tracking-wide text-chalk/50 uppercase">Recent pulls</p>
          <ul className="space-y-1.5">
            {opened.map((pack) => (
              <li key={pack.id} className="flex flex-wrap items-baseline gap-x-2 text-xs text-chalk/60">
                <span className="font-mono text-chalk/45">{pack.openedAt ? new Date(pack.openedAt).toLocaleDateString() : ''}</span>
                <span className="font-medium text-chalk/80">{pack.label ?? PACK_SOURCE_LABEL[pack.source]}</span>
                <span className="truncate text-chalk/45">{(pack.drawn ?? []).map((d) => d.name).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ErrorNote error={open.error} />

      <AnimatePresence>
        {revealed ? (
          <motion.div
            className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setRevealed(null)}
          >
            <motion.div
              className="panel w-full max-w-5xl p-5"
              initial={{ y: 24, scale: 0.97 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 16, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 280, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-xl font-semibold text-chalk">
                    {revealed.cards.length} card{revealed.cards.length === 1 ? '' : 's'} from your{' '}
                    {packTheme(revealed.pack.themeId).name.toLowerCase()}
                  </h3>
                  <p className="text-sm text-chalk/60">{revealed.pack.label ?? PACK_SOURCE_LABEL[revealed.pack.source]} — filed in your collection.</p>
                </div>
                <Button onClick={() => setRevealed(null)}>Done</Button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {revealed.cards.map((card, i) => {
                  const rating = rateCard(card.card);
                  return (
                    <motion.div
                      key={card.id}
                      initial={{ opacity: 0, y: 24, rotate: -2 }}
                      animate={{ opacity: 1, y: 0, rotate: 0 }}
                      transition={{ delay: 0.08 * i, type: 'spring', stiffness: 260, damping: 22 }}
                    >
                      <BallCard card={card.card} rarity={faceLabel(rating.rarity)} tier={rating.rarity} />
                      <p className="mt-1 truncate font-mono text-[11px] text-chalk/50">{rating.headline}</p>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Panel>
  );
}
