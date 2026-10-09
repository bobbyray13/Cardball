import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { rateCard } from '@cardball/shared';
import type { CardSnapshot, PersonSummary } from '@cardball/shared';
import { api } from '../api.js';
import { ZoomableCard } from '../components/CardZoom.js';
import { PhotoUploader } from '../components/PhotoUploader.js';
import { pushCardToast } from '../components/Toasts.js';
import { Button, EmptyState, ErrorNote, Field, Panel, Spinner, inputClass, useAction, useLoad } from '../components/ui.js';

/**
 * Card search: find a player in the full MLB database, pick which year's card
 * you own, look at what it does, and file it in your collection — optionally
 * with a photo of the real card.
 */
export function SearchPage() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [person, setPerson] = useState<PersonSummary | null>(null);

  const results = useLoad(
    () => (submitted.length >= 2 ? api.searchPeople(submitted) : Promise.resolve({ people: [] })),
    [submitted],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-chalk">Card search</h1>
        <p className="mt-1 text-sm text-chalk/60">
          Every player in MLB history. Pick a card year and we build the card from the six seasons before it.
        </p>
      </div>

      <Panel>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(query.trim());
          }}
        >
          <div className="min-w-56 flex-1">
            <Field label="Player name">
              <input
                name="playerQuery"
                className={inputClass}
                placeholder="Willie Mays, Ichiro, Greg Maddux…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                minLength={2}
              />
            </Field>
          </div>
          <Button type="submit" variant="primary">
            Search
          </Button>
        </form>
      </Panel>

      <ErrorNote error={results.error} />

      {results.loading ? (
        <Spinner label="Searching the record books…" />
      ) : submitted.length >= 2 && (results.data?.people.length ?? 0) === 0 ? (
        <EmptyState title="No players found">Try a different spelling, or just a last name.</EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <Panel title={submitted ? `Results for “${submitted}”` : 'Start typing'}>
            <ul className="divide-y divide-white/10">
              {(results.data?.people ?? []).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`flex w-full items-baseline justify-between gap-3 px-1 py-2.5 text-left transition-colors hover:bg-white/5 ${
                      person?.id === p.id ? 'bg-gold/10' : ''
                    }`}
                    onClick={() => setPerson(p)}
                  >
                    <span>
                      <span className="font-medium text-chalk">
                        {p.nameFirst} {p.nameLast}
                      </span>
                      <span className="ml-2 font-mono text-xs text-chalk/45">
                        {p.debutYear ?? '?'}–{p.finalYear ?? '?'}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-chalk/50">
                      {p.primaryPosition ? <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono">{p.primaryPosition}</span> : null}
                      {p.isStarter ? <span className="text-gold">SP</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          {person ? <CardPicker person={person} /> : <EmptyState title="Pick a player">Their card back and card years show up here.</EmptyState>}
        </div>
      )}
    </div>
  );
}

function CardPicker({ person }: { person: PersonSummary }) {
  const detail = useLoad(() => api.person(person.id), [person.id]);
  const [year, setYear] = useState<number | null>(null);
  const [photoId, setPhotoId] = useState<number | null>(null);
  const [setLabel, setSetLabel] = useState('');
  const [added, setAdded] = useState<string | null>(null);

  const range = detail.data?.cardYears ?? null;
  const activeYear = year ?? range?.max ?? null;

  useEffect(() => {
    setYear(null);
    setPhotoId(null);
    setAdded(null);
    setSetLabel('');
  }, [person.id]);

  const preview = useLoad(
    () => (activeYear === null ? Promise.resolve(null) : api.previewCard(person.id, activeYear)),
    [person.id, activeYear],
  );

  const add = useAction(async () => {
    if (activeYear === null) return;
    const { card } = await api.addCard({
      personId: person.id,
      cardYear: activeYear,
      setLabel,
      photoId,
      source: photoId ? 'photo' : 'database',
    });
    setAdded(`${card.card.name} ${card.card.cardYear} added to your collection.`);
    const rating = rateCard(card.card);
    pushCardToast({
      title: card.card.name,
      detail: 'Filed in your collection',
      rarity: rating.rarity,
      headline: rating.headline,
      year: card.card.cardYear,
      href: '/collection',
    });
  });

  const card: CardSnapshot | null = preview.data?.card ?? null;

  return (
    <Panel
      title={`${person.nameFirst} ${person.nameLast}`}
      subtitle={range ? `Card years ${range.min}–${range.max}` : 'No career data'}
    >
      {detail.loading ? (
        <Spinner />
      ) : !range ? (
        <EmptyState title="No seasons on record for this player" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold tracking-wide text-chalk/60 uppercase">Card year</label>
            <input
              type="range"
              min={range.min}
              max={range.max}
              value={activeYear ?? range.min}
              onChange={(e) => setYear(Number(e.target.value))}
              className="flex-1 accent-[var(--color-gold)]"
            />
            <input
              type="number"
              name="cardYear"
              min={range.min}
              max={range.max}
              value={activeYear ?? range.min}
              onChange={(e) => setYear(Number(e.target.value))}
              className={`${inputClass} w-24`}
            />
          </div>

          <ErrorNote error={preview.error} />

          {card ? (
            <motion.div key={card.cardYear} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4 sm:grid-cols-2">
              <ZoomableCard target={{ card, photoId: photoId ?? preview.data?.artPhotoId ?? null }} face="front" />
              <ZoomableCard target={{ card }} face="back" />
            </motion.div>
          ) : (
            <Spinner label="Building the card…" />
          )}

          {card && !card.playable ? (
            <p className="rounded-lg border border-crimson/50 bg-crimson/10 px-3 py-2 text-sm text-crimson">{card.ineligibleReason}</p>
          ) : null}

          <div className="space-y-3 border-t border-white/10 pt-4">
            <Field label="Set (optional)" hint="Topps, Upper Deck, your own label…">
              <input className={inputClass} value={setLabel} onChange={(e) => setSetLabel(e.target.value)} maxLength={80} />
            </Field>

            <div>
              <p className="mb-1 text-xs font-semibold tracking-wide text-chalk/60 uppercase">Photo of your card (optional)</p>
              <PhotoUploader photoId={photoId} onUploaded={setPhotoId} />
            </div>

            {added ? (
              <p className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold">
                {added}{' '}
                <Link className="underline" to="/collection">
                  View collection
                </Link>
              </p>
            ) : null}

            <ErrorNote error={add.error} />

            <div className="flex gap-2">
              <Button variant="primary" disabled={!card || add.busy || activeYear === null} onClick={() => void add.execute()}>
                {add.busy ? 'Filing…' : 'Add to collection'}
              </Button>
              <Link to="/collection">
                <Button>Go to collection</Button>
              </Link>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
