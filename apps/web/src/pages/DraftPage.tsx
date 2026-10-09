import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { OUT_OF_POSITION_RATING } from '@cardball/engine';
import { WINNER_PACK_THEMES, packTheme } from '@cardball/shared';
import type {
  CardSnapshot,
  DraftCard,
  DraftConfig,
  DraftSeatPicks,
  DraftTeamView,
  DraftView,
  PackThemeId,
  Position,
  SavedLineup,
} from '@cardball/shared';
import { api } from '../api.js';
import { BallCard } from '../components/BallCard.js';
import { CardZoom } from '../components/CardZoom.js';
import { LineupBuilder, lineupProblem } from '../components/LineupBuilder.js';
import type { LineupCandidate } from '../components/LineupBuilder.js';
import { PackArt, RevealCards, TearingPack } from '../components/PackArt.js';
import { RarityBadge } from '../components/RarityBadge.js';
import { Button, EmptyState, ErrorNote, Notice, Panel, Spinner, useAction, useFocusTrap, useLoad } from '../components/ui.js';
import { pushCardToast } from '../components/Toasts.js';
import { useSession } from '../session.js';
import { teamAbbr } from '../lib/teams.js';

/** "3 rare / 2 star / 1 mythic", or null when nothing is capped. */
function draftCapsLabel(caps: DraftConfig['rarityCaps']): string | null {
  if (!caps) return null;
  const parts: string[] = [];
  if (caps.rare > 0) parts.push(`${caps.rare} rare`);
  if (caps.star > 0) parts.push(`${caps.star} star`);
  if (caps.mythic > 0) parts.push(`${caps.mythic} mythic`);
  return parts.length > 0 ? `${parts.join(' / ')} each` : null;
}

export function DraftPage() {
  const draftId = Number(useParams().id);
  const { user } = useSession();
  const navigate = useNavigate();

  const [draft, setDraft] = useState<DraftView | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [closed, setClosed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A drafted pick, opened for a quick read while the draft is under way.
  const [peek, setPeek] = useState<DraftCard | null>(null);

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
  // Packs that come back to you open themselves. The very first deal keeps
  // its tear-open ceremony — after that, a wrapper landing in front of you
  // is revealed the moment it arrives, not on the next click.
  const autoTried = useRef('');
  const totalPicks = useMemo(
    () => Object.values(draft?.pickCounts ?? {}).reduce((sum, n) => sum + n, 0),
    [draft?.pickCounts],
  );
  const firstDeal = (draft?.round ?? 0) === 1 && totalPicks === 0;
  useEffect(() => {
    if (!draft || draft.phase !== 'active' || draft.myPack.length === 0 || draft.myPackOpened) return;
    if (draft.round === 1 && totalPicks === 0) return; // the once-a-draft ceremony
    // One auto-open per wrapper: a failure falls back to the button, not a loop.
    const packKey = `${draft.round}:${draft.myPack.map((c) => c.id).join(',')}`;
    if (autoTried.current === packKey || openPack.busy) return;
    autoTried.current = packKey;
    void openPack.execute();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openPack is a useAction handle; packKey guards the calls
  }, [draft, totalPicks, openPack]);
  const pick = useAction(async (cardId: string) => {
    const taken = draft?.myPack.find((c) => c.id === cardId) ?? null;
    const round = draft?.round;
    setDraft((await api.pickDraftCard(draftId, cardId)).draft);
    setSelectedId(null);
    if (taken) {
      pushCardToast({
        title: taken.name,
        detail: `Drafted${round ? ` in round ${round}` : ''} · a draft card until you keep it`,
        rarity: taken.rarity,
        headline: taken.headline,
        year: taken.cardYear,
      });
    }
  });
  const close = useAction(async () => {
    await api.deleteDraft(draftId);
    navigate('/drafts');
  });

  // ---- the assembly and the series ----
  const lockLineup = useAction(async (lineup: SavedLineup) => {
    setDraft((await api.setDraftLineup(draftId, lineup)).draft);
  });
  const rematch = useAction(async () => {
    const { gameId } = await api.rematchDraft(draftId);
    navigate(`/games/${gameId}`);
  });
  const choosePack = useAction(async (gameId: number, themeId: PackThemeId) => {
    setDraft((await api.chooseDraftPack(draftId, gameId, themeId)).draft);
  });
  const keepCard = useAction(async (gameId: number, cardId: string) => {
    setDraft((await api.keepDraftCard(draftId, gameId, cardId)).draft);
  });

  // The seat's full cards, with stats, only once the draft reaches assembly.
  const roomTeam = useLoad(
    () => (draft && (draft.phase === 'assembling' || draft.phase === 'playing') ? api.draftTeam(draftId) : Promise.resolve(null)),
    [draftId, draft?.phase, draft?.updatedAt],
  );

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
  // The tear happens once per draft, on the opening deal; after that, packs
  // that pass back to you reveal themselves (see the auto-open above).
  const firstPack = firstDeal;
  const era = config.yearFrom === config.yearTo ? `${config.yearFrom}` : `${config.yearFrom}–${config.yearTo}`;
  const capsLabel = draftCapsLabel(config.rarityCaps);
  const team = roomTeam.data?.team ?? null;
  const mySeatPicks = draft.seats?.find((s) => s.userId === user?.id) ?? null;

  const phaseLine =
    draft.phase === 'lobby'
      ? 'taking seats'
      : draft.phase === 'active'
        ? `pack ${draft.round} of ${config.rounds}`
        : draft.phase === 'assembling'
          ? 'build your lineup'
          : draft.phase === 'playing'
            ? 'the series'
            : 'complete';

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/drafts" className="text-sm text-chalk/50 hover:text-chalk">
            ← Drafts
          </Link>
          <h1 className="font-display text-3xl font-bold text-chalk">{era} draft</h1>
          <p className="mt-1 text-sm text-chalk/60">
            {config.rounds} packs of {config.packSize} · {phaseLine}
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
            {capsLabel ? (
              <span className="rounded-full border border-gold/40 px-2 py-0.5 text-[10px] tracking-wide text-gold uppercase">cap {capsLabel}</span>
            ) : null}
          </div>
        </div>
        {isHost ? (
          <Button variant="danger" size="sm" disabled={close.busy} onClick={() => void close.execute()}>
            Close room
          </Button>
        ) : null}
      </section>

      <PickClockBanner draft={draft} />

      <SeatStrip draft={draft} />

      <ErrorNote
        error={
          join.error ??
          start.error ??
          openPack.error ??
          pick.error ??
          close.error ??
          lockLineup.error ??
          rematch.error ??
          choosePack.error ??
          keepCard.error
        }
      />

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
        <>
          <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
            <Panel
              title={sealed ? 'Your pack' : myTurn ? 'Your pick' : `Waiting on ${stillPicking.map((p) => p.name).join(', ') || '…'}`}
              subtitle={
                sealed
                  ? `${myTheme?.name ?? 'A pack'} is in front of you.${firstPack ? ' Tear it open.' : ' Opening it…'}`
                  : myTurn
                    ? `Tap a card to look at it, then take it. The rest pass ${draft.passDirection} once everyone has picked.`
                    : `You've taken your card. The packs pass ${draft.passDirection} when everyone has picked.`
              }
            >
              {draft.myPack.length === 0 ? (
                <EmptyState title="No pack in hand" />
              ) : sealed ? (
                firstPack && myTheme ? (
                  <div className="py-4">
                    <TearingPack theme={myTheme} busy={openPack.busy} label="Tear it open" onOpen={() => void openPack.execute()} />
                  </div>
                ) : (
                  // Later rounds skip the ceremony: a quick fade and straight in.
                  <RevealCards>
                    <div className="flex flex-wrap items-center gap-3">
                      {myTheme ? <PackArt theme={myTheme} size="sm" /> : null}
                      <div className="min-w-0">
                        <p className="text-sm text-chalk/70">{myTheme?.name ?? 'Your pack'} is in front of you.</p>
                        <p className="text-xs text-chalk/50">Later rounds skip the tear — open it and pick.</p>
                      </div>
                      <Button variant="primary" disabled={openPack.busy} onClick={() => void openPack.execute()}>
                        {openPack.busy ? 'Opening…' : 'Open the pack'}
                      </Button>
                    </div>
                  </RevealCards>
                )
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
                  {sealed ? 'Open the pack to see what is inside.' : myTurn ? 'Pick a card from your pack to see its front and back.' : 'Hang tight.'}
                </p>
              )}
            </Panel>
          </div>

          <TheTable draft={draft} meSeat={me.seat} onPeek={setPeek} />
        </>
      ) : null}

      {draft.phase === 'assembling' ? (
        <AssemblyPanel
          draft={draft}
          team={team}
          loading={roomTeam.loading}
          loadError={roomTeam.error}
          mySeat={mySeatPicks}
          onLock={(lineup) => void lockLineup.execute(lineup)}
          busy={lockLineup.busy}
        />
      ) : null}

      {draft.phase === 'playing' ? (
        <SeriesPanel
          draft={draft}
          team={team}
          loading={roomTeam.loading}
          mySeat={mySeatPicks}
          onChoosePack={(gameId, themeId) => void choosePack.execute(gameId, themeId)}
          onKeep={(gameId, cardId) => void keepCard.execute(gameId, cardId)}
          onRematch={() => void rematch.execute()}
          busy={choosePack.busy || keepCard.busy || rematch.busy}
        />
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
                ? `${draft.myTally.rare}/${config.rarityCaps.rare} rare · ${draft.myTally.star}/${config.rarityCaps.star} star · ${draft.myTally.mythic}/${config.rarityCaps.mythic} mythic`
                : undefined
            }
          >
            {draft.tournamentId !== null && draft.phase === 'active' ? <RosterNeeds picks={draft.myPicks} /> : null}
            {draft.myPicks.length === 0 ? (
              <p className="text-sm text-chalk/55">Nothing yet.</p>
            ) : (
              <PositionalRundown picks={draft.myPicks} onPeek={setPeek} />
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

      <PickPeekModal card={peek} onClose={() => setPeek(null)} />
    </div>
  );
}

function SeatStrip({ draft }: { draft: DraftView }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {draft.participants.map((p) => {
        const onClock = draft.phase === 'active' && draft.waitingOn.includes(p.seat);
        const seat = draft.seats?.find((s) => s.seat === p.seat) ?? null;
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
            {seat?.lineupReady ? <span className="text-[10px] tracking-wide text-gold uppercase" title="Lineup locked in">ready</span> : null}
            {onClock ? <span className="h-2 w-2 animate-pulse rounded-full bg-gold" aria-label="still picking" /> : null}
            {draft.phase === 'active' && !onClock ? <span className="text-xs text-chalk/60" aria-label="picked">✓</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The host's pick clock reads from server state and ticks locally against the
 * next REST refresh. The banner only appears while a fresh pass is open and a
 * clock was set, so a no-clock room is just the seat strip.
 */
function PickClockBanner({ draft }: { draft: DraftView }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (draft.pickDeadlineAt === null) return;
    if (draft.phase !== 'active') return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [draft.pickDeadlineAt, draft.phase]);
  if (draft.pickDeadlineAt === null || draft.phase !== 'active') return null;
  const remaining = Math.max(0, Math.ceil((draft.pickDeadlineAt - now) / 1000));
  const expiring = remaining <= 15;
  const still = draft.waitingOn.length;
  return (
    <div
      className={`rounded-xl border px-4 py-2.5 text-sm transition-colors ${
        expiring ? 'border-crimson bg-crimson/10 text-chalk' : 'border-gold/30 bg-black/20 text-chalk/85'
      }`}
      role="status"
      aria-live="polite"
    >
      <span className="font-mono font-semibold tabular-nums">{formatClock(remaining)}</span>
      <span className="ml-2 text-chalk/65">
        {still === 0
          ? 'Seat is up next — the picks are in.'
          : still === 1
            ? '1 seat still picking — the server will auto-pick when the clock runs out.'
            : `${still} seats still picking — the server will auto-pick any that miss the clock.`}
      </span>
    </div>
  );
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Every seat's construction, as it emerges — both teams visible during the draft. */
function TheTable({ draft, meSeat, onPeek }: { draft: DraftView; meSeat: number; onPeek: (card: DraftCard) => void }) {
  return (
    <Panel title="The table" subtitle="Every seat's build, position by position. Tap a name to read the card.">
      <ul className="grid gap-3 sm:grid-cols-2">
        {(draft.seats ?? []).map((seat) => (
          <li
            key={seat.seat}
            className={`rounded-xl border p-3 ${seat.seat === meSeat ? 'border-gold/50 bg-gold/5' : 'border-white/10 bg-black/20'}`}
          >
            <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-xs text-chalk/40">{seat.seat + 1}</span>
              <span className="font-medium text-chalk">{seat.name}</span>
              {seat.isHost ? <span className="text-[10px] tracking-wide text-gold uppercase">host</span> : null}
              {seat.seat === meSeat ? <span className="text-[10px] tracking-wide text-chalk/50 uppercase">you</span> : null}
              {seat.lineupReady ? <span className="text-[10px] tracking-wide text-gold uppercase">ready</span> : null}
              <span className="ml-auto font-mono text-xs text-chalk/45">{seat.picks.length} picked</span>
            </div>
            <PositionalRundown picks={seat.picks} onPeek={onPeek} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** The slots a rundown reads off: the eight field positions, the DH, and the staff. */
const RUNDOWN: readonly (Position | 'SP' | 'RP')[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP'];

/**
 * One seat's picks, slotted by position. Pitchers never fill a bat slot — the
 * engine counts a card as either — and scarcer bats (fewer eligible positions)
 * claim their spots first, so a multi-position pick never strands a slot a
 * specialist could have covered. Whatever is left piles onto the DH, the way
 * a real bench does. An empty field slot reads "open": the position a manager
 * still has to take care of.
 */
function rundownOf(picks: DraftCard[]): Record<string, DraftCard[]> {
  const slots = Object.fromEntries(RUNDOWN.map((slot) => [slot, [] as DraftCard[]]));
  for (const card of picks) {
    if (card.starter) slots.SP!.push(card);
    else if (card.reliever) slots.RP!.push(card);
  }
  const bats = picks
    .filter((card) => !card.starter && !card.reliever && (card.positions ?? []).length > 0)
    .sort((a, b) => (a.positions ?? []).length - (b.positions ?? []).length);
  for (const card of bats) {
    const open = (card.positions ?? []).find((pos) => pos !== 'DH' && (slots[pos] ?? []).length === 0);
    const home = open ? slots[open] : slots.DH;
    (home ?? []).push(card);
  }
  return slots;
}

function PositionalRundown({ picks, onPeek }: { picks: DraftCard[]; onPeek: (card: DraftCard) => void }) {
  if (picks.length === 0) return <p className="text-xs text-chalk/45">Nothing yet.</p>;
  const slots = rundownOf(picks);
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-1 min-[420px]:grid-cols-2 sm:grid-cols-3">
      {RUNDOWN.map((slot) => {
        const names = slots[slot] ?? [];
        // Only a missing fielder or starter is a real hole to fill.
        const missing = names.length === 0 && slot !== 'DH' && slot !== 'RP';
        return (
          <div key={slot} className="flex items-baseline gap-2">
            <span className="w-7 shrink-0 font-mono text-[10px] font-bold text-chalk/45">{slot}</span>
            {names.length === 0 ? (
              <span className={`text-xs ${missing ? 'text-gold/80' : 'text-chalk/30'}`}>{missing ? 'open' : '—'}</span>
            ) : (
              <span className="flex min-w-0 flex-wrap gap-x-2">
                {names.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => onPeek(card)}
                    title={`${card.name} — ${card.headline}`}
                    className="truncate text-xs text-chalk hover:text-gold hover:underline"
                  >
                    {card.name}
                  </button>
                ))}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A compact read of a drafted pick, for a manager who wants the card details. */
function PickPeekModal({ card, onClose }: { card: DraftCard | null; onClose: () => void }) {
  const trap = useFocusTrap(card !== null);
  if (!card) return null;
  const positions = card.positions ?? [];
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${card.name}, ${card.cardYear}`}
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div ref={trap} tabIndex={-1} className="panel w-full max-w-sm p-4 outline-none" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-semibold text-chalk">{card.name}</h3>
            <p className="text-sm text-chalk/60">
              {card.cardYear} · {teamAbbr(card.teamLabel) || 'Cardball'}
            </p>
          </div>
          <RarityBadge rarity={card.rarity} />
        </div>
        <p className="mt-2 font-mono text-sm text-chalk/80">{card.headline}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {positions.map((pos) => (
            <span key={pos} className="rounded border border-white/20 px-1.5 py-0.5 font-mono text-[10px] text-chalk/70">
              {pos}
            </span>
          ))}
          {card.starter ? <span className="rounded border border-gold/40 px-1.5 py-0.5 font-mono text-[10px] text-gold">SP</span> : null}
          {card.reliever ? <span className="rounded border border-sky-300/40 px-1.5 py-0.5 font-mono text-[10px] text-sky-200">RP</span> : null}
          {positions.length === 0 && !card.starter && !card.reliever ? (
            <span className="font-mono text-[10px] text-chalk/50">no position</span>
          ) : null}
        </div>
        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The assembly screen, after the last pick: the seat's cards, a suggested
 * lineup, and a place to lock one in. The other seat's build is shown so a
 * manager can size up the series before it starts.
 */
function AssemblyPanel({
  draft,
  team,
  loading,
  loadError,
  mySeat,
  onLock,
  busy,
}: {
  draft: DraftView;
  team: DraftTeamView | null;
  loading: boolean;
  loadError: unknown;
  mySeat: DraftSeatPicks | null;
  onLock: (lineup: SavedLineup) => void;
  busy: boolean;
}) {
  const [lineup, setLineup] = useState<SavedLineup | null>(null);

  // Seed from the locked lineup, or the server's suggestion, when it arrives.
  useEffect(() => {
    if (!team) return;
    setLineup(team.lineup ?? team.suggested ?? null);
  }, [team]);

  const candidates = useMemo<LineupCandidate[]>(
    () =>
      (team?.cards ?? []).map(({ card, snapshot }) => ({
        id: card.id,
        name: card.name,
        cardYear: card.cardYear,
        positions: snapshot.positions.length > 0 ? snapshot.positions : (card.positions ?? []),
        pitcherClass: snapshot.pitcherClass,
        canBat: snapshot.canBat,
      })),
    [team],
  );

  const current: SavedLineup = lineup ?? { lineup: [], fieldPositions: {}, startingPitcherId: '' };
  const problem = lineupProblem(candidates, current);
  const locked = draft.myLineup !== null;
  const others = (draft.seats ?? []).filter((s) => s.seat !== mySeat?.seat);
  const waiting = (draft.seats ?? []).filter((s) => !s.lineupReady);

  return (
    <div className="space-y-6">
      <Panel title="Cards drafted — build your lineup" subtitle="Your picks are your team. Set nine, pick a starter, and lock it in.">
        <ErrorNote error={loadError} />
        {loading && !team ? (
          <Spinner label="Fetching your cards…" />
        ) : !team ? (
          <p className="text-sm text-chalk/55">Your cards could not be loaded. Refresh the room to try again.</p>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {team.cards.map(({ card, snapshot, artPhotoId }) => (
                <div key={card.id}>
                  <BallCard card={snapshot} photoId={artPhotoId ?? null} rarity={card.rarity === 'common' ? null : card.rarity} tier={card.rarity} />
                  <p className="mt-1 truncate font-mono text-[11px] text-chalk/50">{card.headline}</p>
                </div>
              ))}
            </div>

            {locked ? (
              <Notice>Your lineup is locked in. Change it below and lock it again to update it.</Notice>
            ) : null}

            <div className="mb-3 flex flex-wrap items-center gap-2">
              {team.suggested ? (
                <Button size="sm" onClick={() => setLineup(team.suggested)}>
                  Use the suggested lineup
                </Button>
              ) : null}
              <Button
                variant="primary"
                size="sm"
                disabled={busy || !!problem}
                onClick={() => onLock(current)}
              >
                {busy ? 'Locking…' : locked ? 'Update lineup' : 'Lock lineup'}
              </Button>
            </div>

            <LineupBuilder candidates={candidates} value={current} outOfPosition onChange={setLineup} />
            {problem ? <p className="mt-3 text-sm text-chalk/50">{problem}</p> : null}
          </>
        )}
      </Panel>

      <Panel title="The other dugout" subtitle="Waiting on lineups">
        {waiting.length === 0 ? (
          <p className="text-sm text-gold/90">Everyone is assembled. The first pitch is next.</p>
        ) : (
          <p className="text-sm text-chalk/60">
            Waiting on {waiting.map((s) => s.name).join(', ')} to lock a lineup.
          </p>
        )}
        <ul className="mt-3 space-y-3">
          {others.map((seat) => (
            <li key={seat.seat} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="font-medium text-chalk">{seat.name}</span>
                {seat.lineupReady ? <span className="text-[10px] tracking-wide text-gold uppercase">ready</span> : null}
                <span className="ml-auto font-mono text-xs text-chalk/45">{seat.picks.length} picked</span>
              </div>
              {seat.picks.length === 0 ? (
                <p className="text-xs text-chalk/45">Nothing yet.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {seat.picks.map((card) => (
                    <span key={card.id} className="rounded-lg border border-white/10 bg-black/25 px-2 py-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-xs text-chalk">{card.name}</span>
                        <RarityBadge rarity={card.rarity} />
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1">
                        {(card.positions ?? []).length > 0 ? (
                          (card.positions ?? []).map((pos) => (
                            <span key={pos} className="rounded border border-white/15 px-1 font-mono text-[9px] text-chalk/60">
                              {pos}
                            </span>
                          ))
                        ) : (
                          <span className="font-mono text-[9px] text-chalk/40">{card.starter ? 'SP' : card.reliever ? 'RP' : '—'}</span>
                        )}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/**
 * The series, once every seat is assembled: the games so far, the winner's
 * bonus-pack choice, and the one card a winner keeps from each game.
 */
function SeriesPanel({
  draft,
  team,
  loading,
  mySeat,
  onChoosePack,
  onKeep,
  onRematch,
  busy,
}: {
  draft: DraftView;
  team: DraftTeamView | null;
  loading: boolean;
  mySeat: DraftSeatPicks | null;
  onChoosePack: (gameId: number, themeId: PackThemeId) => void;
  onKeep: (gameId: number, cardId: string) => void;
  onRematch: () => void;
  busy: boolean;
}) {
  const games = draft.games ?? [];
  const keeps = draft.myKeeps ?? {};
  const nameFor = (seat: number) => draft.seats?.find((s) => s.seat === seat)?.name ?? `Seat ${seat + 1}`;
  const keptIds = new Set(Object.values(keeps).filter((id): id is string => id !== null));
  const nameOfCard = (id: string) => team?.cards.find((c) => c.card.id === id)?.card.name ?? id;
  const pendingKeeps = Object.entries(keeps)
    .filter(([, cardId]) => cardId === null)
    .map(([gameId]) => Number(gameId));
  const currentFinished = draft.gameId !== null && games.some((g) => g.gameId === draft.gameId);
  const gameNumber = (gameId: number) => games.findIndex((g) => g.gameId === gameId) + 1;

  return (
    <div className="space-y-6">
      <Panel
        title="The series"
        subtitle={draft.gameId !== null ? 'The current game is on the field.' : 'The next game is being dealt.'}
        actions={
          draft.gameId !== null ? (
            <Link to={`/games/${draft.gameId}`}>
              <Button size="sm" variant="primary">
                Go to the game →
              </Button>
            </Link>
          ) : null
        }
      >
        {games.length === 0 ? (
          <p className="text-sm text-chalk/60">No games played yet.</p>
        ) : (
          <ol className="space-y-2">
            {games.map((g, i) => (
              <li key={g.gameId} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                <span className="font-mono text-xs text-chalk/40">Game {i + 1}</span>
                <span className="font-medium text-chalk">
                  {nameFor(g.awaySeat)} {g.awayScore}–{g.homeScore} {nameFor(g.homeSeat)}
                </span>
                {g.winnerSeat !== null ? (
                  <span className="text-xs text-gold">{nameFor(g.winnerSeat)} won</span>
                ) : (
                  <span className="text-xs text-chalk/50">in progress</span>
                )}
                {g.gameId === draft.gameId ? <span className="ml-auto text-xs text-gold/80">current</span> : null}
              </li>
            ))}
          </ol>
        )}
        {currentFinished && mySeat ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-3">
            <Button variant="primary" disabled={busy} onClick={onRematch}>
              Rematch the series
            </Button>
          </div>
        ) : null}
      </Panel>

      {/* The winner's bonus pack: four wrappers to choose between. */}
      {draft.myPendingChoice !== null ? (
        <Panel title={`Bonus pack for game ${gameNumber(draft.myPendingChoice)}`} subtitle="You won it — pick the wrapper.">
          <div className="flex flex-wrap gap-3">
            {WINNER_PACK_THEMES.map((id) => {
              const theme = packTheme(id);
              return (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  onClick={() => onChoosePack(draft.myPendingChoice!, id)}
                  className="rounded-xl border border-white/15 p-3 text-left transition-transform hover:-translate-y-1 disabled:opacity-50"
                  style={{ background: `linear-gradient(150deg, ${theme.colors.from}, ${theme.colors.to})`, color: theme.colors.ink }}
                >
                  <PackArt theme={theme} size="sm" />
                  <span className="mt-2 block text-xs font-semibold">{theme.name}</span>
                  <span className="block text-[10px] opacity-80">{theme.hold}</span>
                </button>
              );
            })}
          </div>
        </Panel>
      ) : null}

      {/* Keep one card from each game won, filed into the collection. */}
      {pendingKeeps.length > 0 ? (
        <Panel title="Keep one card" subtitle="The winner files one card from the team they fielded.">
          {loading && !team ? (
            <Spinner label="Fetching your cards…" />
          ) : !team ? (
            <p className="text-sm text-chalk/55">Your cards could not be loaded.</p>
          ) : (
            pendingKeeps.map((gameId) => (
              <div key={gameId} className="mb-4 last:mb-0">
                <p className="mb-2 text-sm text-chalk/70">Game {gameNumber(gameId)} — pick the card you keep.</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {team.cards.map(({ card }) => {
                    const alreadyKept = keptIds.has(card.id);
                    return (
                      <button
                        key={card.id}
                        type="button"
                        disabled={busy || alreadyKept}
                        onClick={() => onKeep(gameId, card.id)}
                        className={`rounded-lg border p-2 text-left transition-colors ${
                          alreadyKept ? 'border-white/5 opacity-40' : 'border-white/15 bg-black/20 hover:border-gold/50'
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-xs text-chalk">{card.name}</span>
                          <RarityBadge rarity={card.rarity} />
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-chalk/50">
                          {card.cardYear} · {card.headline}
                        </span>
                        {alreadyKept ? <span className="text-[10px] text-chalk/40">already kept</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </Panel>
      ) : null}

      {Object.keys(keeps).length > 0 ? (
        <Panel title="Your keeps" subtitle="One card a game, out of the games you won.">
          <ul className="space-y-1.5 text-sm">
            {Object.entries(keeps).map(([gameId, cardId]) => (
              <li key={gameId} className="flex items-center gap-2">
                <span className="font-mono text-xs text-chalk/40">Game {gameNumber(Number(gameId))}</span>
                <span className="text-chalk">{cardId === null ? 'pick pending…' : nameOfCard(cardId)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
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
  const positions = card.positions ?? [];
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
      <span className="mt-0.5 block text-xs text-chalk/55">{teamAbbr(card.teamLabel)}</span>
      {/* Where he plays, read at a glance while the pack is in hand. */}
      <span className="mt-1.5 flex flex-wrap items-center gap-1">
        {positions.length > 0 ? (
          positions.map((pos) => (
            <span
              key={pos}
              className="rounded border border-chalk/50 bg-black/35 px-1.5 py-0.5 font-mono text-[10px] font-bold text-chalk"
            >
              {pos}
            </span>
          ))
        ) : (
          <span className="rounded border border-chalk/50 bg-black/35 px-1.5 py-0.5 font-mono text-[10px] font-bold text-chalk">
            {card.starter ? 'SP' : card.reliever ? 'RP' : '—'}
          </span>
        )}
      </span>
      <span className="mt-1.5 block font-mono text-xs text-chalk/75">{card.headline}</span>
      {capped ? <span className="mt-1 block text-xs text-crimson">At your {card.rarity} cap for this draft</span> : null}
    </button>
  );
}

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

/** Would taking this card break the draft's rarity cap? */
function overCap(draft: DraftView, card: DraftCard): boolean {
  const caps = draft.config.rarityCaps;
  if (!caps) return false;
  if (card.rarity === 'rare') return draft.myTally.rare >= caps.rare;
  if (card.rarity === 'star') return draft.myTally.star >= caps.star;
  if (card.rarity === 'mythic') return draft.myTally.mythic >= caps.mythic;
  return false;
}

function CardPreview({ card }: { card: DraftCard }) {
  const [snapshot, setSnapshot] = useState<CardSnapshot | null>(null);
  const [artPhotoId, setArtPhotoId] = useState<number | null>(null);
  const [face, setFace] = useState<'front' | 'back'>('front');
  const [zoomed, setZoomed] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    setError(null);
    api
      .previewCard(card.personId, card.cardYear)
      .then((res) => {
        if (cancelled) return;
        setSnapshot(res.card);
        setArtPhotoId(res.artPhotoId);
      })
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
        <BallCard card={snapshot} photoId={artPhotoId} rarity={card.rarity === 'common' ? null : card.rarity} tier={card.rarity} face={face} />
      </button>
      <p className="text-center text-xs text-chalk/45">
        Tap the card to flip it, or{' '}
        <button type="button" className="text-gold underline" onClick={() => setZoomed(true)}>
          zoom in
        </button>{' '}
        to read it.
      </p>
      <CardZoom
        target={zoomed ? { card: snapshot, photoId: artPhotoId, rarity: card.rarity === 'common' ? null : card.rarity, tier: card.rarity } : null}
        onClose={() => setZoomed(false)}
      />
    </div>
  );
}
