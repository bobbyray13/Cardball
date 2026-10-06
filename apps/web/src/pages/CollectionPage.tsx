import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { RARITY_LABEL, RARITY_ORDER, faceLabel, rarityRank, rateCard } from '@cardball/shared';
import type { CardRating, CollectionCard, DraftRarity } from '@cardball/shared';
import { api } from '../api.js';
import { BallCard } from '../components/BallCard.js';
import { CardZoom, CareerSummary } from '../components/CardZoom.js';
import { RarityBadge } from '../components/RarityBadge.js';
import { PhotoUploader } from '../components/PhotoUploader.js';
import { Button, EmptyState, ErrorNote, Field, Panel, Spinner, inputClass, useAction, useLoad } from '../components/ui.js';

type SortKey = 'rarity' | 'newest' | 'name' | 'year-desc' | 'year-asc';
type RoleFilter = 'all' | 'hitters' | 'pitchers';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'rarity', label: 'Rarest first' },
  { key: 'newest', label: 'Newest added' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'year-desc', label: 'Card year, newest' },
  { key: 'year-asc', label: 'Card year, oldest' },
];

const SORT_STORAGE_KEY = 'cardball.collection.sort';

export function CollectionPage() {
  const collection = useLoad(() => api.collection(), []);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>(() => (localStorage.getItem(SORT_STORAGE_KEY) as SortKey | null) ?? 'rarity');
  const [tierFilter, setTierFilter] = useState<DraftRarity | 'all'>('all');
  const [role, setRole] = useState<RoleFilter>('all');
  const [photosOnly, setPhotosOnly] = useState(false);
  const [selected, setSelected] = useState<CollectionCard | null>(null);
  const cards = useMemo(() => collection.data?.cards ?? [], [collection.data]);

  const ratings = useMemo(() => new Map(cards.map((c) => [c.id, rateCard(c.card)])), [cards]);
  const ratingOf = (c: CollectionCard) => ratings.get(c.id) ?? rateCard(c.card);

  const tierCounts = useMemo(() => {
    const counts: Record<DraftRarity, number> = { common: 0, uncommon: 0, rare: 0, chase: 0 };
    for (const r of ratings.values()) counts[r.rarity]++;
    return counts;
  }, [ratings]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = cards.filter((c) => {
      const r = ratings.get(c.id)!;
      if (tierFilter !== 'all' && r.rarity !== tierFilter) return false;
      if (role === 'hitters' && !c.card.canBat) return false;
      if (role === 'pitchers' && !c.card.canPitch) return false;
      if (photosOnly && !c.photoId) return false;
      if (!needle) return true;
      return (
        c.card.name.toLowerCase().includes(needle) ||
        c.setLabel.toLowerCase().includes(needle) ||
        c.card.teamLabel.toLowerCase().includes(needle) ||
        String(c.card.cardYear).includes(needle) ||
        c.card.positions.some((p) => p.toLowerCase() === needle)
      );
    });
    const byRarity = (a: CollectionCard, b: CollectionCard) => {
      const ra = ratings.get(a.id)!;
      const rb = ratings.get(b.id)!;
      return rarityRank(rb.rarity) - rarityRank(ra.rarity) || rb.score - ra.score;
    };
    const compare: Record<SortKey, (a: CollectionCard, b: CollectionCard) => number> = {
      rarity: byRarity,
      newest: (a, b) => b.addedAt.localeCompare(a.addedAt),
      name: (a, b) => a.card.name.localeCompare(b.card.name),
      'year-desc': (a, b) => b.card.cardYear - a.card.cardYear || a.card.name.localeCompare(b.card.name),
      'year-asc': (a, b) => a.card.cardYear - b.card.cardYear || a.card.name.localeCompare(b.card.name),
    };
    return [...list].sort(compare[sort]);
  }, [cards, ratings, query, sort, tierFilter, role, photosOnly]);

  // The binder's best cards, for the showcase shelf.
  const highlights = useMemo(
    () =>
      [...cards]
        .filter((c) => rarityRank(ratings.get(c.id)!.rarity) >= rarityRank('rare'))
        .sort((a, b) => {
          const ra = ratings.get(a.id)!;
          const rb = ratings.get(b.id)!;
          return rarityRank(rb.rarity) - rarityRank(ra.rarity) || rb.score - ra.score;
        })
        .slice(0, 5),
    [cards, ratings],
  );

  const filtering = query.trim() !== '' || tierFilter !== 'all' || role !== 'all' || photosOnly;

  // Under "Rarest first", split the grid into one shelf per tier.
  const groups = useMemo(() => {
    if (sort !== 'rarity') return [{ tier: null as DraftRarity | null, cards: filtered }];
    return [...RARITY_ORDER]
      .reverse()
      .map((tier) => ({ tier: tier as DraftRarity | null, cards: filtered.filter((c) => ratings.get(c.id)!.rarity === tier) }))
      .filter((g) => g.cards.length > 0);
  }, [filtered, sort, ratings]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-chalk">Your collection</h1>
          <p className="mt-1 text-sm text-chalk/60">
            {cards.length} {cards.length === 1 ? 'card' : 'cards'} · {tierCounts.chase} chase · {tierCounts.rare} rare ·{' '}
            {cards.filter((c) => c.photoId).length} with your own photo
          </p>
        </div>
        <Link to="/search">
          <Button variant="primary">Add cards</Button>
        </Link>
      </div>

      {highlights.length > 0 && !filtering ? (
        <Showcase cards={highlights} ratingOf={ratingOf} onSelect={setSelected} />
      ) : null}

      <Panel>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <input
              name="collectionFilter"
              className={`${inputClass} min-w-0 flex-1`}
              placeholder="Search player, team, year, set, or position (SS, CF)…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              name="collectionSort"
              aria-label="Sort"
              className={`${inputClass} w-auto`}
              value={sort}
              onChange={(e) => {
                const next = e.target.value as SortKey;
                setSort(next);
                localStorage.setItem(SORT_STORAGE_KEY, next);
              }}
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip active={tierFilter === 'all'} onClick={() => setTierFilter('all')}>
              All {cards.length}
            </Chip>
            {[...RARITY_ORDER].reverse().map((tier) => (
              <Chip key={tier} active={tierFilter === tier} onClick={() => setTierFilter(tierFilter === tier ? 'all' : tier)} disabled={tierCounts[tier] === 0}>
                {RARITY_LABEL[tier]} {tierCounts[tier]}
              </Chip>
            ))}
            <span className="mx-1 h-4 w-px bg-white/15" />
            {(['all', 'hitters', 'pitchers'] as const).map((r) => (
              <Chip key={r} active={role === r} onClick={() => setRole(r)}>
                {r === 'all' ? 'Everyone' : r === 'hitters' ? 'Hitters' : 'Pitchers'}
              </Chip>
            ))}
            <Chip active={photosOnly} onClick={() => setPhotosOnly(!photosOnly)}>
              With photo
            </Chip>
          </div>
        </div>
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
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.tier ?? 'all'}>
              {group.tier ? (
                <h2 className="mb-3 flex items-center gap-2 font-display text-lg text-chalk">
                  <RarityBadge rarity={group.tier} /> <span className="text-sm text-chalk/50">{group.cards.length}</span>
                </h2>
              ) : null}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {group.cards.map((entry) => {
                  const rating = ratingOf(entry);
                  return (
                    <button key={entry.id} type="button" className="text-left transition-transform hover:-translate-y-1" onClick={() => setSelected(entry)}>
                      <BallCard card={entry.card} photoId={entry.photoId} rarity={faceLabel(rating.rarity)} tier={rating.rarity} />
                      <div className="mt-2 flex items-center gap-1.5">
                        {sort !== 'rarity' ? <RarityBadge rarity={rating.rarity} /> : null}
                        <p className="min-w-0 truncate text-xs text-chalk/55">
                          {entry.setLabel || 'Cardball'} {entry.card.cardYear}
                          {entry.quantity > 1 ? ` · ×${entry.quantity}` : ''}
                        </p>
                      </div>
                      <p className="truncate font-mono text-[11px] text-chalk/40">{rating.headline}</p>
                    </button>
                  );
                })}
              </div>
            </section>
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

function Chip({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-35 ${
        active ? 'bg-chalk text-field-deep' : 'border border-white/15 text-chalk/70 hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  );
}

/** The binder's best cards, fanned out on a shelf. */
function Showcase({
  cards,
  ratingOf,
  onSelect,
}: {
  cards: CollectionCard[];
  ratingOf: (c: CollectionCard) => CardRating;
  onSelect: (c: CollectionCard) => void;
}) {
  const mid = (cards.length - 1) / 2;
  return (
    <section className="panel overflow-hidden bg-[radial-gradient(600px_220px_at_50%_100%,rgba(216,168,60,0.18),transparent)] px-4 pt-4 pb-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-display text-xl font-semibold text-chalk">Top of the binder</h2>
        <span className="text-xs text-chalk/45">Your rarest cards, by their best season</span>
      </div>
      <div className="flex items-end justify-center pt-4">
        {cards.map((entry, i) => {
          const offset = i - mid;
          const rating = ratingOf(entry);
          return (
            <motion.button
              key={entry.id}
              type="button"
              onClick={() => onSelect(entry)}
              className="relative -mx-3 w-[30%] max-w-[180px] min-w-[96px] sm:-mx-2"
              style={{ zIndex: 10 - Math.abs(Math.round(offset)) }}
              initial={{ opacity: 0, y: 30, rotate: 0 }}
              animate={{ opacity: 1, y: Math.abs(offset) * 10, rotate: offset * 5 }}
              whileHover={{ y: -12, rotate: 0, scale: 1.06, zIndex: 20 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22, delay: i * 0.05 }}
            >
              <BallCard card={entry.card} photoId={entry.photoId} rarity={faceLabel(rating.rarity)} tier={rating.rarity} />
            </motion.button>
          );
        })}
      </div>
    </section>
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
  const [zoomed, setZoomed] = useState(false);

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
            <button type="button" className="block w-full cursor-zoom-in" onClick={() => setZoomed(true)} title="Zoom in">
              <BallCard card={entry.card} photoId={entry.photoId} rarity={entry.rarity} face="front" />
            </button>
            <p className="mt-2 text-center text-xs text-chalk/50">Front · tap to zoom</p>
          </div>
          <div>
            <button type="button" className="block w-full cursor-zoom-in" onClick={() => setZoomed(true)} title="Zoom in">
              <BallCard card={entry.card} face="back" />
            </button>
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

            <CareerSummary userCardId={entry.id} />

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
        <CardZoom target={zoomed ? { card: entry.card, photoId: entry.photoId, rarity: entry.rarity } : null} onClose={() => setZoomed(false)} />
      </motion.div>
    </motion.div>
  );
}
