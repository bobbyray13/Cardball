import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { OUT_OF_POSITION_RATING } from '@cardball/engine';
import type { CardSnapshot, DraftCard, DraftView, Position } from '@cardball/shared';
import { packTheme } from '@cardball/shared';
import { api } from '../api.js';
import { BallCard } from '../components/BallCard.js';
import { CardZoom } from '../components/CardZoom.js';
import { PackArt, RevealCards, TearingPack } from '../components/PackArt.js';
import { RarityBadge } from '../components/RarityBadge.js';
import { Button, EmptyState, ErrorNote, Notice, Panel, Spinner, useAction } from '../components/ui.js';
import { pushCardToast } from '../components/Toasts.js';
import { useSession } from '../session.js';

export function DraftPage() {
  const draftId = Number(useParams().id);
  const { user } = useSession();
  const navigate = useNavigate();

  const [draft, setDraft] = useState<DraftView | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [closed, setClosed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { draft: next } = await api.draft(draftId);
      setDraft(next);
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    }
  }, [draftId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The server only sends a nudge; the room itself always comes from REST so
  // each manager sees just their own pack.
  useEffect(() => {
    if (!Number.isFinite(draftId)) return;
    const socket: Socket = io({ path: '/socket.io', withCredentials: true });
    socket.on('connect', () => socket.emit('draft:join', draftId, () => void refresh()));
    socket.on('draft:update', () => void refresh());
    socket.on('draft:closed', () => setClosed(true));
    return () => {
      socket.emit('draft:leave', draftId);
      socket.close();
    };
  }, [draftId, refresh]);

  const join = useAction(async () => setDraft((await api.joinDraft(draftId)).draft));
  const start = useAction(async () => setDraft((await api.startDraft(draftId)).draft));
  const openPack = useAction(async () => setDraft((await api.openDraftPack(draftId)).draft));
  const pick = useAction(async (cardId: string) => {
    const taken = draft?.myPack.find((c) => c.id === cardId) ?? null;
    const round = draft?.round;
    setDraft((await api.pickDraftCard(draftId, cardId)).draft);
    setSelectedId(null);
    if (taken) {
      pushCardToast({
        title: taken.name,
        detail: `Drafted${round ? ` in round ${round}` : ''} · filed in your collection`,
        rarity: taken.rarity,
        headline: taken.headline,
        year: taken.cardYear,
        href: '/collection',
      });
    }
  });
  const close = useAction(async () => {
    await api.deleteDraft(draftId);
    navigate('/drafts');
  });

  if (closed) {
    return (
      <EmptyState title="The host closed this room">
        <Link className="text-gold underline" to="/drafts">
          Back to drafts
        </Link>
      </EmptyState>
    );
  }
  if (loadError && !draft) return <ErrorNote error={loadError} />;
  if (!draft) return <Spinner label="Opening the room…" />;

  const me = draft.participants.find((p) => p.userId === user?.id) ?? null;
  const isHost = draft.hostUserId === user?.id;
  const stillPicking = draft.participants.filter((p) => draft.waitingOn.includes(p.seat));
  const myTurn = draft.phase === 'active' && me !== null && draft.waitingOn.includes(me.seat);
  const { config } = draft;
  const selected = draft.myPack.find((c) => c.id === selectedId) ?? null;
  const myTheme = draft.myPackTheme ? packTheme(draft.myPackTheme) : null;
  const sealed = draft.myPack.length > 0 && !draft.myPackOpened;
  const era = config.yearFrom === config.yearTo ? `${config.yearFrom}` : `${config.yearFrom}–${config.yearTo}`;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/drafts" className="text-sm text-chalk/50 hover:text-chalk">
            ← Drafts
          </Link>
          <h1 className="font-display text-3xl font-bold text-chalk">{era} draft</h1>
          <p className="mt-1 text-sm text-chalk/60">
            {config.rounds} packs of {config.packSize} ·{' '}
            {draft.phase === 'lobby' ? 'taking seats' : draft.phase === 'active' ? `pack ${draft.round} of ${config.rounds}` : 'complete'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {config.themes.map((id) => {
              const theme = packTheme(id);
              return (
                <span
                  key={id}
                  className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase"
                  style={{ color: theme.colors.ink, background: `linear-gradient(120deg, ${theme.colors.from}, ${theme.colors.to})` }}
                >
                  {theme.name}
                </span>
              );
            })}
            {config.rarityCaps ? (
              <span className="rounded-full border border-gold/40 px-2 py-0.5 text-[10px] tracking-wide text-gold uppercase">
                cap {config.rarityCaps.rare} rare · {config.rarityCaps.chase} chase
              </span>
            ) : null}
          </div>
        </div>
        {isHost ? (
          <Button variant="danger" size="sm" disabled={close.busy} onClick={() => void close.execute()}>
            Close room
          </Button>
        ) : null}
      </section>

      <SeatStrip draft={draft} />

      <ErrorNote error={join.error ?? start.error ?? openPack.error ?? pick.error ?? close.error} />

      {draft.phase === 'lobby' ? (
        <Panel title="Waiting for managers">
          <div className="space-y-3 text-sm text-chalk/70">
            <p>Share this page's link with your league. The host deals when everyone has a seat.</p>
            {!me ? (
              <Button variant="primary" disabled={join.busy} onClick={() => void join.execute()}>
                Take a seat
              </Button>
            ) : isHost ? (
              <Button variant="primary" disabled={start.busy || draft.participants.length < 2} onClick={() => void start.execute()}>
                {draft.participants.length < 2 ? 'Need one more manager' : start.busy ? 'Dealing…' : 'Deal the packs'}
              </Button>
            ) : (
              <Notice>You're in. Waiting for the host to deal.</Notice>
            )}
          </div>
        </Panel>
      ) : null}

      {draft.phase === 'active' && me ? (
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <Panel
            title={sealed ? 'Your pack' : myTurn ? 'Your pick' : `Waiting on ${stillPicking.map((p) => p.name).join(', ') || '…'}`}
            subtitle={
              sealed
                ? `${myTheme?.name ?? 'A pack'} is in front of you. Tear it open.`
                : myTurn
                  ? `Tap a card to look at it, then take it. The rest pass ${draft.passDirection} once everyone has picked.`
                  : `You've taken your card. The packs pass ${draft.passDirection} when everyone has picked.`
            }
          >
            {draft.myPack.length === 0 ? (
              <EmptyState title="No pack in hand" />
            ) : sealed && myTheme ? (
              <div className="py-4">
                <TearingPack theme={myTheme} busy={openPack.busy} label="Tear it open" onOpen={() => void openPack.execute()} />
              </div>
            ) : (
              <RevealCards>
                <div className="mb-3 flex items-center gap-3">
                  {myTheme ? <PackArt theme={myTheme} size="sm" sealed={false} /> : null}
                  <p className="text-sm text-chalk/60">
                    {draft.myPack.length} card{draft.myPack.length === 1 ? '' : 's'} left in this {myTheme?.name ?? 'pack'}.
                  </p>
                </div>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {/* The taken card leaves the pack on the next render; no exit
                      animation, so a ghost of it can't linger in the list. */}
                  {draft.myPack.map((card) => (
                    <motion.li key={card.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                      <PackCardButton
                        card={card}
                        selected={card.id === selectedId}
                        disabled={!myTurn}
                        capped={overCap(draft, card)}
                        onSelect={() => setSelectedId(card.id)}
                      />
                      {myTurn && card.id === selectedId ? (
                        <Button
                          variant="primary"
                          size="sm"
                          className="mt-1.5 w-full lg:hidden"
                          disabled={pick.busy || overCap(draft, card)}
                          onClick={() => void pick.execute(card.id)}
                        >
                          {pick.busy ? 'Taking…' : `Take ${card.name}`}
                        </Button>
                      ) : null}
                    </motion.li>
                  ))}
                </ul>
              </RevealCards>
            )}
          </Panel>

          <Panel title={selected ? selected.name : 'Card preview'}>
            {selected ? (
              <div className="space-y-3">
                <CardPreview card={selected} />
                {overCap(draft, selected) ? (
                  <Notice>You've hit this draft's {selected.rarity} cap. Pick a different card.</Notice>
                ) : null}
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={!myTurn || pick.busy || overCap(draft, selected)}
                  onClick={() => void pick.execute(selected.id)}
                >
                  {pick.busy ? 'Taking…' : `Take ${selected.name}`}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-chalk/55">
                {sealed ? 'Tear the pack open to see what is inside.' : myTurn ? 'Pick a card from your pack to see its front and back.' : 'Hang tight.'}
              </p>
            )}
          </Panel>
        </div>
      ) : null}

      {draft.phase === 'finished' ? (
        <Panel title="Draft complete">
          {draft.tournamentId !== null ? (
            <p className="text-sm text-chalk/70">
              Your {draft.myPicks.length} picks are your tournament team.{' '}
              <Link to={`/tournaments/${draft.tournamentId}`} className="text-gold underline">
                Back to the tournament
              </Link>
              .
            </p>
          ) : (
            <p className="text-sm text-chalk/70">
              Your {draft.myPicks.length} picks are in your{' '}
              <Link to="/collection" className="text-gold underline">
                collection
              </Link>
              . Build a team with them next.
            </p>
          )}
        </Panel>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {me ? (
          <Panel
            title={`Your picks (${draft.myPicks.length})`}
            subtitle={
              config.rarityCaps
                ? `${draft.myTally.rare}/${config.rarityCaps.rare} rare · ${draft.myTally.chase}/${config.rarityCaps.chase} chase`
                : undefined
            }
          >
            {draft.tournamentId !== null && draft.phase === 'active' ? <RosterNeeds picks={draft.myPicks} /> : null}
            {draft.myPicks.length === 0 ? (
              <p className="text-sm text-chalk/55">Nothing yet.</p>
            ) : (
              <ol className="space-y-1.5">
                {draft.myPicks.map((card, i) => (
                  <li key={card.id} className="flex items-center gap-2 text-sm">
                    <span className="w-6 font-mono text-xs text-chalk/40">{i + 1}.</span>
                    <span className="text-chalk">{card.name}</span>
                    <RarityBadge rarity={card.rarity} />
                    <span className="ml-auto truncate text-xs text-chalk/50">{card.headline}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        ) : null}

        <Panel title="Draft log">
          <ol className="max-h-80 space-y-1 overflow-y-auto text-sm text-chalk/70">
            {[...draft.log].reverse().map((entry) => (
              <li key={entry.seq}>{entry.text}</li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}

function SeatStrip({ draft }: { draft: DraftView }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {draft.participants.map((p) => {
        const onClock = draft.phase === 'active' && draft.waitingOn.includes(p.seat);
        return (
          <li
            key={p.userId}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              onClock ? 'border-gold bg-gold/15 text-chalk' : 'border-white/15 text-chalk/70'
            }`}
          >
            <span className="font-mono text-xs text-chalk/40">{p.seat + 1}</span>
            <span className="font-medium">{p.name}</span>
            {p.isHost ? <span className="text-[10px] tracking-wide text-gold uppercase">host</span> : null}
            {draft.phase !== 'lobby' ? <span className="font-mono text-xs text-chalk/50">{draft.pickCounts[String(p.seat)] ?? 0}</span> : null}
            {onClock ? <span className="h-2 w-2 animate-pulse rounded-full bg-gold" aria-label="still picking" /> : null}
            {draft.phase === 'active' && !onClock ? <span className="text-xs text-chalk/60" aria-label="picked">✓</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function PackCardButton({
  card,
  selected,
  disabled,
  capped,
  onSelect,
}: {
  card: DraftCard;
  selected: boolean;
  disabled: boolean;
  capped: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      name={`pack-${card.personId}`}
      onClick={onSelect}
      className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
        selected ? 'border-gold bg-gold/10' : 'border-white/10 bg-black/20 hover:border-white/30'
      } ${disabled ? 'opacity-75' : ''}`}
    >
      <span className="flex items-center gap-2">
        <span className="font-medium text-chalk">{card.name}</span>
        <span className="ml-auto">
          <RarityBadge rarity={card.rarity} />
        </span>
      </span>
      <span className="mt-0.5 block text-xs text-chalk/55">{card.teamLabel}</span>
      <span className="mt-1 block font-mono text-xs text-chalk/75">{card.headline}</span>
      {capped ? <span className="mt-1 block text-xs text-ember">At your {card.rarity} cap for this draft</span> : null}
    </button>
  );
}

/** Would taking this card break the draft's rarity cap? */
const FIELD: readonly Position[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

/**
 * A tournament roster is only what its manager drafts, so the room keeps a
 * running list of what the picks still can't cover.
 */
function RosterNeeds({ picks }: { picks: DraftCard[] }) {
  const covered = new Set(picks.flatMap((c) => c.positions ?? []));
  const missing = FIELD.filter((pos) => !covered.has(pos));
  const hitters = new Set(picks.filter((c) => (c.positions ?? []).length > 0).map((c) => c.personId)).size;
  const hasStarter = picks.some((c) => c.starter);
  const needs: string[] = [];
  if (missing.length) {
    needs.push(`Nobody for ${missing.join(', ')} yet. Someone will play there out of position (fielding ${OUT_OF_POSITION_RATING}).`);
  }
  if (hitters < 9) needs.push(`${hitters} of the 9 hitters you need.`);
  if (!hasStarter) needs.push('No starting pitcher yet. Without one, your team forfeits.');

  if (needs.length === 0) {
    return <p className="mb-3 text-sm text-gold/90">Every position covered, nine bats, and a starter on the staff.</p>;
  }
  return (
    <div className="mb-3">
      <Notice>
        <span className="font-semibold">Your tournament roster is only what you draft.</span> {needs.join(' ')}
      </Notice>
    </div>
  );
}

function overCap(draft: DraftView, card: DraftCard): boolean {
  const caps = draft.config.rarityCaps;
  if (!caps) return false;
  if (card.rarity === 'chase') return draft.myTally.chase >= caps.chase;
  if (card.rarity === 'rare') return draft.myTally.rare >= caps.rare;
  return false;
}

function CardPreview({ card }: { card: DraftCard }) {
  const [snapshot, setSnapshot] = useState<CardSnapshot | null>(null);
  const [face, setFace] = useState<'front' | 'back'>('front');
  const [zoomed, setZoomed] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    setError(null);
    api
      .previewCard(card.personId, card.cardYear)
      .then((res) => !cancelled && setSnapshot(res.card))
      .catch((err: unknown) => !cancelled && setError(err));
    return () => {
      cancelled = true;
    };
  }, [card.personId, card.cardYear]);

  if (error) return <ErrorNote error={error} />;
  if (!snapshot) return <Spinner label="Pulling the card…" />;
  return (
    <div className="space-y-2">
      <button type="button" className="mx-auto block w-full max-w-[260px]" onClick={() => setFace((f) => (f === 'front' ? 'back' : 'front'))}>
        <BallCard card={snapshot} rarity={card.rarity === 'common' ? null : card.rarity} face={face} />
      </button>
      <p className="text-center text-xs text-chalk/45">
        Tap the card to flip it, or{' '}
        <button type="button" className="text-gold underline" onClick={() => setZoomed(true)}>
          zoom in
        </button>{' '}
        to read it.
      </p>
      <CardZoom target={zoomed ? { card: snapshot, rarity: card.rarity === 'common' ? null : card.rarity, tier: card.rarity } : null} onClose={() => setZoomed(false)} />
    </div>
  );
}
