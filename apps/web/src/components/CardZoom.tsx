import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { activeHouseRules, battingAverage, earnedRunAverage, formatBattingLine, formatPitchingLine, hitMod, inningsLabel, onBasePct, pitMod, sbMod, sluggingPct } from '@cardball/shared';
import type { CardCareer, CardSnapshot, DraftRarity } from '@cardball/shared';
import type { EnginePlayer } from '@cardball/engine';
import { api } from '../api.js';
import { BallCard } from './BallCard.js';
import type { CardFace } from './BallCard.js';
import { ErrorNote, Spinner } from './ui.js';

export interface ZoomTarget {
  card: CardSnapshot;
  photoId?: number | null | undefined;
  rarity?: string | null | undefined;
  tier?: DraftRarity | null | undefined;
  /** a collection card: its history in your games shows beside it */
  userCardId?: number | null | undefined;
  /** anything else worth reading next to the card, like today's line */
  details?: ReactNode;
}

/**
 * A card, big enough to read. Sized off the viewport so the back's stat
 * table is legible on a laptop; the seasons also print as a plain table beside
 * the card at every size, since a card that fits a screen can still be too
 * small for its own fine print.
 */
export function CardZoom({ target, onClose }: { target: ZoomTarget | null; onClose: () => void }) {
  const [face, setFace] = useState<CardFace>('front');

  useEffect(() => {
    if (!target) return;
    setFace('front');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ' || e.key === 'f') {
        e.preventDefault();
        setFace((f) => (f === 'front' ? 'back' : 'front'));
      }
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [target, onClose]);

  return createPortal(
    <AnimatePresence>
      {target ? (
        <motion.div
          key="zoom"
          role="dialog"
          aria-modal="true"
          aria-label={`${target.card.name}, ${target.card.cardYear}`}
          className="fixed inset-0 z-[70] overflow-y-auto bg-black/80 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="flex min-h-full items-start justify-center p-3 sm:items-center sm:p-6">
            <motion.div
              className="grid w-full max-w-5xl items-start gap-5 md:grid-cols-[auto_minmax(16rem,1fr)]"
              initial={{ scale: 0.92, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto w-[min(92vw,calc(84vh*5/7),38rem)]">
                <button
                  type="button"
                  className="block w-full cursor-pointer"
                  onClick={() => setFace((f) => (f === 'front' ? 'back' : 'front'))}
                  aria-label={face === 'front' ? 'Flip to the back' : 'Flip to the front'}
                >
                  <motion.div key={face} initial={{ rotateY: 90 }} animate={{ rotateY: 0 }} transition={{ duration: 0.22 }}>
                    <BallCard card={target.card} photoId={target.photoId} rarity={target.rarity} tier={target.tier} face={face} />
                  </motion.div>
                </button>
                <div className="mt-3 flex items-center justify-center gap-2">
                  {(['front', 'back'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFace(f)}
                      aria-pressed={face === f}
                      className={`rounded-full px-4 py-1.5 text-sm ${face === f ? 'bg-chalk font-semibold text-field-deep' : 'border border-white/20 text-chalk/75 hover:bg-white/10'}`}
                    >
                      {f === 'front' ? 'Front' : 'Back'}
                    </button>
                  ))}
                  <button type="button" onClick={onClose} className="rounded-full border border-white/20 px-4 py-1.5 text-sm text-chalk/75 hover:bg-white/10">
                    Close
                  </button>
                </div>
              </div>

              <div className="panel space-y-4 p-4">
                <div>
                  <h2 className="font-display text-2xl font-bold text-chalk">{target.card.name}</h2>
                  <p className="text-sm text-chalk/60">
                    {target.card.cardYear} card · {target.card.teamLabel || 'Cardball'} · {target.card.positions.join(', ') || 'no position'}
                  </p>
                </div>
                {target.details}
                {target.userCardId ? <CareerSummary userCardId={target.userCardId} /> : null}
                <SeasonTable card={target.card} />
              </div>
            </motion.div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * The card a game player was built from. The engine keeps everything the dice
 * read but not the card's bats/throws, so those print as unknown.
 */
export function snapshotOfPlayer(player: EnginePlayer): CardSnapshot {
  return {
    personId: 0,
    bbrefId: '',
    name: player.name,
    cardYear: player.cardYear,
    teamLabel: player.teamLabel,
    bats: null,
    throws: null,
    seasons: player.seasons,
    positions: player.positions,
    fielding: player.fielding,
    pitcherClass: player.pitcherClass,
    canBat: player.positions.length > 0,
    canPitch: player.seasons.some((s) => (s.pitching?.ipOuts ?? 0) > 0),
    playable: true,
    ineligibleReason: null,
  };
}

/** One card on the page that opens the zoom when clicked. */
export function ZoomableCard({ target, className = '', face }: { target: ZoomTarget; className?: string; face?: CardFace }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`block w-full text-left transition-transform hover:-translate-y-1 ${className}`} onClick={() => setOpen(true)} title="Zoom in">
        <BallCard card={target.card} photoId={target.photoId} rarity={target.rarity} tier={target.tier} face={face} />
      </button>
      <CardZoom target={open ? target : null} onClose={() => setOpen(false)} />
    </>
  );
}

/** The card back as an ordinary table, readable at any size. */
export function SeasonTable({ card }: { card: CardSnapshot }) {
  const rules = activeHouseRules();
  const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));
  if (card.seasons.length === 0) return <p className="text-sm text-chalk/50">No seasons on this card back.</p>;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold tracking-wide text-chalk/55 uppercase">The card back</p>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-sm tabular-nums">
          <thead>
            <tr className="text-[11px] text-chalk/45">
              <th className="text-left">YR</th>
              <th className="text-right">AVG</th>
              <th className="text-right">HIT</th>
              <th className="text-right">HR</th>
              <th className="text-right">SB</th>
              <th className="text-right">ERA</th>
            </tr>
          </thead>
          <tbody>
            {card.seasons.map((s) => (
              <tr key={s.year} className="border-t border-white/10 text-chalk/80">
                <td className="py-1 text-left">{s.year}</td>
                <td className="text-right">{s.avg === null ? '—' : s.avg.toFixed(3).replace(/^0/, '')}</td>
                <td className="text-right text-crimson">{s.ab >= rules.fullGameAb ? fmt(hitMod(s.avg, rules.hitBands)) : '·'}</td>
                <td className="text-right">{s.homeRuns}</td>
                <td className="text-right">
                  {s.sb} <span className="text-sky-300">{fmt(sbMod(s.sb, rules.sbBands))}</span>
                </td>
                <td className="text-right">
                  {s.pitching ? (
                    <>
                      {s.pitching.era === null ? '—' : s.pitching.era.toFixed(2)} <span className="text-sky-300">{fmt(pitMod(s.pitching.era, rules.pitBands))}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** This collection card's numbers across every game it has finished. */
export function CareerSummary({ userCardId }: { userCardId: number }) {
  const [career, setCareer] = useState<CardCareer | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setCareer(null);
    setError(null);
    api
      .cardCareer(userCardId)
      .then((res) => !cancelled && setCareer(res.career))
      .catch((err: unknown) => !cancelled && setError(err));
    return () => {
      cancelled = true;
    };
  }, [userCardId]);

  if (error) return <ErrorNote error={error} />;
  if (!career) return <Spinner label="Looking up the record…" />;

  const { batting: b, pitching: p } = career;
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold tracking-wide text-chalk/55 uppercase">
        In your games · {career.games} {career.games === 1 ? 'game' : 'games'}
      </p>
      {career.games === 0 ? (
        <p className="text-sm text-chalk/50">This card hasn't finished a game yet. Its line starts with the next one.</p>
      ) : null}
      {b && b.pa > 0 ? (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          <Stat label="AVG" value={battingAverage(b)} strong />
          <Stat label="OBP" value={onBasePct(b)} />
          <Stat label="SLG" value={sluggingPct(b)} />
          <Stat label="H" value={`${b.h}/${b.ab}`} />
          <Stat label="HR" value={b.hr} />
          <Stat label="RBI" value={b.rbi} />
          <Stat label="BB" value={b.bb} />
          <Stat label="SB" value={b.sb} />
        </div>
      ) : null}
      {p && (p.outs > 0 || p.bf > 0) ? (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          <Stat label="ERA" value={earnedRunAverage(p)} strong />
          <Stat label="IP" value={inningsLabel(p.outs)} />
          <Stat label="K" value={p.k} />
          <Stat label="BB" value={p.bb} />
          <Stat label="H" value={p.h} />
          <Stat label="HR" value={p.hr} />
        </div>
      ) : null}
      {career.recent.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {career.recent.slice(0, 6).map((g, i) => (
            <li key={`${g.gameId ?? 'gone'}-${i}`} className="flex flex-wrap items-baseline gap-x-2 border-t border-white/10 pt-1">
              <span className={`w-4 font-mono text-xs font-bold ${g.won ? 'text-gold' : 'text-chalk/40'}`}>{g.won ? 'W' : 'L'}</span>
              <span className="text-chalk/60">vs {g.opponentName}</span>
              <span className="ml-auto font-mono text-xs text-chalk/80">
                {[g.batting ? formatBattingLine(g.batting) : '', g.pitching ? formatPitchingLine(g.pitching) : ''].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Stat({ label, value, strong = false }: { label: string; value: string | number; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-black/25 px-2 py-1.5 text-center">
      <p className="text-[10px] tracking-wide text-chalk/45 uppercase">{label}</p>
      <p className={`font-mono tabular-nums ${strong ? 'text-lg font-bold text-gold' : 'text-sm text-chalk'}`}>{value}</p>
    </div>
  );
}
