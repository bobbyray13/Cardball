import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { CollectionCard } from '@cardball/shared';
import { api } from '../api.js';
import { BallCard } from '../components/BallCard.js';
import { PhotoUploader } from '../components/PhotoUploader.js';
import { Button, EmptyState, ErrorNote, Field, Panel, Spinner, inputClass, useAction, useLoad } from '../components/ui.js';

export function CollectionPage() {
  const collection = useLoad(() => api.collection(), []);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CollectionCard | null>(null);
  const cards = collection.data?.cards ?? [];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return cards;
    return cards.filter((c) => c.card.name.toLowerCase().includes(needle) || c.setLabel.toLowerCase().includes(needle) || String(c.card.cardYear).includes(needle));
  }, [cards, query]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-chalk">Your collection</h1>
          <p className="mt-1 text-sm text-chalk/60">
            {cards.length} {cards.length === 1 ? 'card' : 'cards'} ·{' '}
            {cards.filter((c) => c.photoId).length} with your own photo
          </p>
        </div>
        <Link to="/search">
          <Button variant="primary">Add cards</Button>
        </Link>
      </div>

      <Panel>
        <input
          className={inputClass}
          placeholder="Filter by player, year, or set…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Panel>

      <ErrorNote error={collection.error} />
      {collection.loading && !collection.data ? (
        <Spinner label="Opening the binder…" />
      ) : filtered.length === 0 ? (
        <EmptyState title={cards.length === 0 ? 'Your binder is empty' : 'No cards match that filter'}>
          {cards.length === 0 ? (
            <>
              Search the player database and{' '}
              <Link className="text-gold underline" to="/search">
                add your first card
              </Link>
              .
            </>
          ) : null}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {filtered.map((entry) => (
            <button key={entry.id} type="button" className="text-left transition-transform hover:-translate-y-1" onClick={() => setSelected(entry)}>
              <BallCard card={entry.card} photoId={entry.photoId} rarity={entry.rarity} />
              <p className="mt-2 truncate text-xs text-chalk/55">
                {entry.setLabel || 'Cardball'} {entry.card.cardYear}
                {entry.quantity > 1 ? ` · ×${entry.quantity}` : ''}
              </p>
            </button>
          ))}
        </div>
      )}

      <AnimatePresence>
        {selected ? (
          <CardDetail
            entry={selected}
            onClose={() => setSelected(null)}
            onChanged={(updated) => {
              setSelected(updated);
              collection.reload();
            }}
            onDeleted={() => {
              setSelected(null);
              collection.reload();
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function CardDetail({
  entry,
  onClose,
  onChanged,
  onDeleted,
}: {
  entry: CollectionCard;
  onClose: () => void;
  onChanged: (entry: CollectionCard) => void;
  onDeleted: () => void;
}) {
  const [notes, setNotes] = useState(entry.notes ?? '');
  const [quantity, setQuantity] = useState(entry.quantity);

  const save = useAction(async () => {
    const { card } = await api.updateCard(entry.id, { notes: notes.trim() || null, quantity });
    onChanged(card);
  });
  const attach = useAction(async (photoId: number) => {
    const { card } = await api.updateCard(entry.id, { photoId });
    onChanged(card);
  });
  const remove = useAction(async () => {
    await api.deleteCard(entry.id);
    onDeleted();
  });

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="panel w-full max-w-4xl p-4 sm:p-6"
        initial={{ y: 24, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 16, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
          <div>
            <BallCard card={entry.card} photoId={entry.photoId} rarity={entry.rarity} face="front" />
            <p className="mt-2 text-center text-xs text-chalk/50">Front</p>
          </div>
          <div>
            <BallCard card={entry.card} face="back" />
            <p className="mt-2 text-center text-xs text-chalk/50">Back — the stats the dice read</p>
          </div>

          <div className="space-y-4">
            <div>
              <h2 className="font-display text-2xl font-bold text-chalk">{entry.card.name}</h2>
              <p className="text-sm text-chalk/60">
                {entry.setLabel || 'Cardball'} · {entry.card.cardYear} · {entry.card.teamLabel}
              </p>
              {entry.card.ineligibleReason ? <p className="mt-2 text-sm text-crimson">{entry.card.ineligibleReason}</p> : null}
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold tracking-wide text-chalk/60 uppercase">Your photo</p>
              <PhotoUploader photoId={entry.photoId} label="Add a photo of this card" onUploaded={(id) => void attach.execute(id)} />
              <ErrorNote error={attach.error} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity">
                <input
                  type="number"
                  min={1}
                  max={99}
                  className={inputClass}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
                />
              </Field>
              <Field label="Added">
                <p className="py-2 text-sm text-chalk/60">{new Date(entry.addedAt).toLocaleDateString()}</p>
              </Field>
            </div>

            <Field label="Notes">
              <textarea
                className={`${inputClass} h-20 resize-none`}
                placeholder="Sleeved, corner ding, trade bait…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>

            <ErrorNote error={save.error} />
            <ErrorNote error={remove.error} />

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => void save.execute()} disabled={save.busy}>
                {save.busy ? 'Saving…' : 'Save'}
              </Button>
              <Button onClick={onClose}>Close</Button>
              <Button
                variant="danger"
                className="ml-auto"
                disabled={remove.busy}
                onClick={() => {
                  if (confirm(`Remove ${entry.card.name} from your collection?`)) void remove.execute();
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
