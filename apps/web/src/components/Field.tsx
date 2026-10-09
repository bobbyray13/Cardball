import { memo, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { EnginePlayer, GameEvent, GameState, Side } from '@cardball/engine';
import type { ContactType, HitKind, HouseRules, SeasonStats } from '@cardball/shared';
import { formatBattingLine, formatPitchingLine } from '@cardball/shared';
import {
  batterDue,
  batterPitchMod,
  cardSeasons,
  fatigueInnings,
  fieldingRating,
  fmtMod,
  formatIp,
  getDefense,
  getOffense,
  lineFor,
  pitcherFatigue,
  pitcherTotalMod,
  runnerSbMod,
  runnersOn,
} from '@cardball/engine';
import { BATTER_BOX, BASE_GAP, BASE_SPOTS, FENCE_R, FIELDER_SPOTS, HOME_PLATE, MOUND, pctY } from '../lib/fieldGeometry.js';
import type { Point } from '../lib/fieldGeometry.js';
import { fieldedLeg, stealThrowLeg, throughLeg, unfieldedLeg } from '../lib/ballFlight.js';
import type { ContactRef, FlightLeg } from '../lib/ballFlight.js';
import { teamColors } from './BallCard.js';
import { PlayerSilhouette } from './Silhouette.js';
import type { SilhouettePose } from './Silhouette.js';

/**
 * The season a player is using right now, or his most recent one before the
 * roll-for-year has happened (the lobby). The engine throws when there is no
 * year roll yet, so the mat asks the safe question instead.
 */
function seasonNow(player: EnginePlayer, yearRoll: number | null, rules: HouseRules): SeasonStats | null {
  const seasons = cardSeasons(player, rules);
  if (seasons.length === 0) return null;
  const last = seasons[seasons.length - 1] ?? null;
  if (yearRoll === null) return last;
  return seasons[seasons.length - 1 - ((yearRoll - 1) % seasons.length)] ?? last;
}

/** Shown for a card with no seasons on the back; every modifier reads as 0. */
const NEUTRAL_SEASON: SeasonStats = {
  year: 0,
  teamLabel: '',
  games: 0,
  ab: 0,
  h: 0,
  avg: null,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  rbi: 0,
  sb: 0,
  pa: 0,
  pitching: null,
  primaryPosition: null,
  positionsPlayed: [],
};

export type ZoomPlayer = (side: Side, player: EnginePlayer) => void;

/** Beats that start the ball moving, and beats that send it back to the plate. */
const FLIGHT_KINDS = new Set(['contact', 'fielding', 'hit', 'steal']);
const CLEAR_KINDS = new Set(['pitch', 'ball', 'walk', 'half-end', 'game-over', 'inning-start', 'sub', 'pitcher-change']);

/**
 * The mat. Defenders are tokens in their team color marked with their
 * position; the batting side wears cream with a gold ring, so a glance tells
 * who is in the field and who is trying to score. Runners stand on the bag
 * they hold and slide along the basepaths as plays resolve. The ball itself
 * follows the current beat: hit to the man fielding it, through the gap on a
 * hit, over the fence on a home run.
 */
export const Field = memo(function Field({
  state,
  photos,
  play,
  onZoom,
}: {
  state: GameState;
  photos: Record<string, number>;
  /** the play-by-play beat being revealed right now, which drives the ball */
  play?: GameEvent | null;
  onZoom?: ZoomPlayer;
}) {
  const defense = getDefense(state);
  const offense = getOffense(state);
  const defenseColors = teamColors(defense.name);
  const offenseColors = teamColors(offense.name);
  // After the first paint, a runner reaching base runs in from the plate;
  // on the first paint everyone is already where they belong.
  const firstPaint = useRef(true);
  if (firstPaint.current) {
    queueMicrotask(() => {
      firstPaint.current = false;
    });
  }

  // The ball: one leg at a time, keyed by the beat that started it. The
  // contact beat records where the ball was hit; the fielding beat sends it
  // to the man making the play; the hit beat sends it past him.
  const [leg, setLeg] = useState<FlightLeg | null>(null);
  const lastContact = useRef<ContactRef | null>(null);
  const legSeq = useRef<number | null>(null);

  useEffect(() => {
    if (!play) return;
    const refs = play.refs ?? {};
    if (FLIGHT_KINDS.has(play.kind)) {
      if (play.kind === 'contact' && refs.directionRoll !== undefined && refs.contactType) {
        lastContact.current = { seq: play.seq, directionRoll: refs.directionRoll, contactType: refs.contactType };
        return;
      }
      const contact = lastContact.current;
      if (play.kind === 'fielding') {
        if (!contact) return;
        legSeq.current = play.seq;
        setLeg(fieldedLeg(contact, play.seq, refs.position ?? null));
        return;
      }
      if (play.kind === 'hit') {
        const hitKind: HitKind | undefined = refs.hitKind;
        if (!contact || !hitKind) return;
        if (legSeq.current === null) {
          // No fielding beat came first: a natural 20, or a defensive gap.
          setLeg(unfieldedLeg(contact, play.seq, hitKind));
        } else {
          setLeg((prev) => (prev ? throughLeg(prev, play.seq, hitKind) : prev));
        }
        return;
      }
      if (play.kind === 'steal') {
        if (refs.base !== undefined) setLeg(stealThrowLeg(play.seq, refs.base));
        return;
      }
    }
    if (CLEAR_KINDS.has(play.kind)) {
      legSeq.current = null;
      setLeg(null);
    }
  }, [play]);

  const fielders = defense.players.filter(
    (p): p is EnginePlayer & { fieldPosition: string } => p.status === 'active' && !!p.fieldPosition && p.fieldPosition !== 'DH' && p.fieldPosition !== 'P',
  );
  const pitcher = defense.players.find((p) => p.id === defense.activePitcherId) ?? null;
  const onBase = runnersOn(offense);
  const occupied = onBase
    .map((r) => r.base)
    .filter((b): b is 1 | 2 | 3 => b === 1 || b === 2 || b === 3);
  const batter = state.currentPa
    ? offense.players.find((p) => p.id === state.currentPa!.batterId) ?? batterDue(state)
    : state.phase === 'live'
      ? batterDue(state)
      : null;

  return (
    <div className="space-y-3">
      <div className="@container relative aspect-[4/3] w-full overflow-hidden rounded-2xl ring-1 ring-black/40" style={{ containerType: 'inline-size' }}>
        <FieldArt occupied={occupied} />
        <Scorebug state={state} />
        <Legend defense={defense.name} offense={offense.name} defenseColor={defenseColors.primary} offenseColor={offenseColors.primary} />

        {/* defense — the man making the play flashes gold while the ball is in flight */}
        {fielders.map((fielder) => {
          const spot = FIELDER_SPOTS[fielder.fieldPosition];
          if (!spot) return null;
          const rating = fmtMod(fieldingRating(fielder, fielder.fieldPosition));
          return (
            <Token
              key={fielder.id}
              x={spot.x}
              y={spot.y}
              kind="defense"
              color={defenseColors.primary}
              mark={fielder.fieldPosition}
              label={shortName(fielder.name)}
              detail={rating}
              flash={leg?.defenderPosition === fielder.fieldPosition}
              title={`${fielder.fieldPosition} · ${fielder.name} · fielding ${rating}`}
              photoId={photos[fielder.id]}
              onClick={onZoom ? () => onZoom(defense.side, fielder) : undefined}
            />
          );
        })}
        {pitcher ? (
          <Token
            key={pitcher.id}
            x={MOUND.x}
            y={MOUND.y}
            kind="defense"
            color={defenseColors.primary}
            mark="P"
            label={shortName(pitcher.name)}
            title={`Pitching · ${pitcher.name}`}
            photoId={photos[pitcher.id]}
            onClick={onZoom ? () => onZoom(defense.side, pitcher) : undefined}
          />
        ) : null}

        {/* the batter, standing in */}
        {batter ? (
          <Token
            key={`at-bat-${batter.id}`}
            x={BATTER_BOX.x}
            y={BATTER_BOX.y}
            kind="offense"
            color={offenseColors.primary}
            pose="Stance"
            label={shortName(batter.name)}
            title={`At bat · ${batter.name}`}
            photoId={photos[batter.id]}
            onClick={onZoom ? () => onZoom(offense.side, batter) : undefined}
          />
        ) : null}

        {/* runners, on the bag they hold, sliding between bases as plays resolve */}
        {onBase.map((runner) => {
          const spot = BASE_SPOTS[runner.base as 1 | 2 | 3];
          if (!spot) return null;
          const sb = fmtMod(runnerSbMod(seasonNow(runner, offense.yearRoll, state.config.rules) ?? NEUTRAL_SEASON, state.config.rules).mod);
          return (
            <Token
              key={runner.id}
              x={spot.x}
              y={spot.y}
              from={firstPaint.current ? undefined : HOME_PLATE}
              kind="offense"
              color={offenseColors.primary}
              pose="OF"
              label={shortName(runner.name)}
              detail={`SB ${sb}`}
              title={`${runner.name} on ${runner.base === 1 ? 'first' : runner.base === 2 ? 'second' : 'third'} · SB ${sb}`}
              photoId={photos[runner.id]}
              onClick={onZoom ? () => onZoom(offense.side, runner) : undefined}
            />
          );
        })}

        {/* the ball, following the beat */}
        {leg ? <BallFlight leg={leg} /> : null}
      </div>

      <MatchupStrip state={state} pitcher={pitcher} photos={photos} onZoom={onZoom} />
    </div>
  );
});

/**
 * One player on the mat: a round token with a name tag hanging under it.
 * Sized in `cqw` against the field's width, so the spacing worked out in
 * field units holds from a phone to a desktop.
 */
function Token({
  x,
  y,
  from,
  kind,
  color,
  mark,
  pose,
  label,
  detail,
  flash,
  title,
  photoId,
  onClick,
}: {
  x: number;
  y: number;
  /** where a runner springs in from (home plate); omit to appear in place */
  from?: { x: number; y: number } | undefined;
  kind: 'defense' | 'offense';
  color: string;
  /** the position printed on a defender's token */
  mark?: string;
  /** the silhouette on a batter's or runner's token */
  pose?: SilhouettePose;
  label: string;
  detail?: string;
  /** the man making the play lights up while the ball is in flight to him */
  flash?: boolean;
  title: string;
  photoId?: number | null | undefined;
  onClick?: (() => void) | undefined;
}) {
  const offense = kind === 'offense';
  const face = photoId ? (
    <img src={`/api/photos/${photoId}`} alt="" className="h-full w-full rounded-full object-cover" />
  ) : pose ? (
    <PlayerSilhouette pose={pose} className="h-[78%] w-[78%]" />
  ) : (
    <span className="font-mono text-[clamp(8px,1.9cqw,14px)] leading-none font-bold">{mark}</span>
  );

  return (
    <motion.button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      title={title}
      aria-label={title}
      // Centered on the token itself, not the token plus its tag.
      className="group absolute z-10 flex -translate-x-1/2 flex-col items-center enabled:cursor-zoom-in"
      style={{ marginTop: '-2.6cqw' }}
      initial={from ? { left: `${from.x}%`, top: `${pctY(from.y)}%`, opacity: 0, scale: 0.6 } : false}
      animate={{ left: `${x}%`, top: `${pctY(y)}%`, opacity: 1, scale: flash ? 1.14 : 1 }}
      transition={{ type: 'spring', stiffness: 180, damping: 22 }}
    >
      <span
        className={`grid h-[5.2cqw] w-[5.2cqw] min-h-5 min-w-5 place-items-center rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.55)] transition group-enabled:group-hover:scale-110 ${
          offense ? 'border-[0.45cqw] border-gold bg-chalk ring-[0.5cqw] ring-gold/30' : 'border-[0.35cqw] border-chalk/90 text-chalk'
        } ${flash ? 'ring-[0.6cqw] ring-gold' : ''}`}
        style={offense ? { color } : { background: color }}
      >
        {face}
      </span>
      <span
        className={`mt-[0.4cqw] max-w-[13cqw] truncate rounded-full px-[1cqw] py-[0.15cqw] text-[clamp(7px,1.55cqw,12px)] leading-tight font-semibold whitespace-nowrap shadow ${
          offense ? 'bg-gold text-ink' : 'bg-black/65 text-chalk'
        }`}
      >
        {label}
        {detail ? <span className={`pl-[0.6cqw] font-mono font-normal ${offense ? 'text-ink/70' : 'text-chalk/65'}`}>{detail}</span> : null}
      </span>
    </motion.button>
  );
}

/** The inning, the outs, and the score, painted in the corner like a broadcast bug. */
function Scorebug({ state }: { state: GameState }) {
  const half = state.half === 'top' ? '▲' : '▼';
  return (
    <div className="pointer-events-none absolute top-[2cqw] left-[2cqw] z-20 overflow-hidden rounded-[1.2cqw] bg-black/70 font-mono text-[clamp(8px,1.7cqw,13px)] text-chalk shadow-lg ring-1 ring-white/10">
      {[state.away, state.home].map((team) => (
        <div key={team.side} className={`flex items-center justify-between gap-[2cqw] px-[1.6cqw] py-[0.5cqw] ${getOffense(state).side === team.side ? 'bg-white/10' : ''}`}>
          <span className="max-w-[16cqw] truncate font-sans font-semibold">{team.name}</span>
          <span className="font-bold tabular-nums">{team.score}</span>
        </div>
      ))}
      <div className="flex items-center justify-between gap-[2cqw] border-t border-white/10 px-[1.6cqw] py-[0.5cqw] text-chalk/80">
        <span>
          {half} {state.inning}
        </span>
        <span className="flex items-center gap-[0.6cqw]" aria-label={`${state.outs} out${state.outs === 1 ? '' : 's'}`}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={`h-[1.3cqw] min-h-1.5 w-[1.3cqw] min-w-1.5 rounded-full ${i < state.outs ? 'bg-gold' : 'bg-white/20'}`} />
          ))}
        </span>
      </div>
    </div>
  );
}

/** Which team is which, in the opposite corner. */
function Legend({ defense, offense, defenseColor, offenseColor }: { defense: string; offense: string; defenseColor: string; offenseColor: string }) {
  return (
    <div className="pointer-events-none absolute top-[2cqw] right-[2cqw] z-20 space-y-[0.6cqw] rounded-[1.2cqw] bg-black/55 px-[1.6cqw] py-[1cqw] text-[clamp(7px,1.5cqw,12px)] text-chalk/85">
      <div className="flex items-center gap-[1cqw]">
        <span className="h-[1.8cqw] min-h-2 w-[1.8cqw] min-w-2 rounded-full border border-chalk/90" style={{ background: defenseColor }} />
        <span className="max-w-[18cqw] truncate">In the field · {defense}</span>
      </div>
      <div className="flex items-center gap-[1cqw]">
        <span className="h-[1.8cqw] min-h-2 w-[1.8cqw] min-w-2 rounded-full border-2 border-gold bg-chalk" style={{ color: offenseColor }} />
        <span className="max-w-[18cqw] truncate">At bat · {offense}</span>
      </div>
    </div>
  );
}

/** The batter/pitcher matchup, with the pitch-roll modifiers on both sides. */
function MatchupStrip({
  state,
  pitcher,
  photos,
  onZoom,
}: {
  state: GameState;
  pitcher: EnginePlayer | null;
  photos: Record<string, number>;
  onZoom?: ZoomPlayer | undefined;
}) {
  const offense = getOffense(state);
  const defense = getDefense(state);
  const rules = state.config.rules;
  const batter = state.currentPa ? offense.players.find((p) => p.id === state.currentPa!.batterId) ?? batterDue(state) : batterDue(state);
  const batterSeason = batter ? seasonNow(batter, offense.yearRoll, rules) : null;
  const batterMod = batterSeason ? batterPitchMod(batterSeason, rules) : null;
  const pitcherSeason = pitcher ? seasonNow(pitcher, defense.yearRoll, rules) : null;
  // Season PIT plus what the innings have cost him: the reading the dice use.
  const pitcherMod = pitcher ? pitcherTotalMod(state, pitcher) : null;
  const pitcherFatigueValue = pitcher ? pitcherFatigue(state, pitcher) : 0;
  const pitcherFatiguedInnings = pitcher ? fatigueInnings(state, pitcher) : 0;
  const batterToday = batter ? lineFor(state, offense.side, batter.id).batting : null;
  const pitcherToday = pitcher ? lineFor(state, defense.side, pitcher.id).pitching : null;
  const pitching = pitcherSeason?.pitching ?? null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <MatchupSide
        label={`At bat · ${offense.name}`}
        name={batter?.name ?? '—'}
        sub={batter ? `${batter.cardYear} card · ${batterSeason?.year ?? '—'} season` : ''}
        mod={batterMod ? `HIT ${fmtMod(batterMod.mod)}` : ''}
        photoId={batter ? photos[batter.id] : undefined}
        accent="var(--color-crimson)"
        stats={
          batterSeason
            ? [
                ['AVG', batterSeason.avg === null ? '—' : batterSeason.avg.toFixed(3).replace(/^0/, '')],
                ['HR', String(batterSeason.homeRuns)],
                ['RBI', String(batterSeason.rbi)],
                ['SB', `${batterSeason.sb} ${fmtMod(runnerSbMod(batterSeason, rules).mod)}`],
              ]
            : []
        }
        today={batterToday && batterToday.pa > 0 ? formatBattingLine(batterToday) : 'First time up today'}
        onZoom={batter && onZoom ? () => onZoom(offense.side, batter) : undefined}
      />
      <MatchupSide
        label={`On the mound · ${defense.name}`}
        name={pitcher?.name ?? '—'}
        sub={pitcher ? `${pitcher.pitchingRole ?? 'pitcher'} · ${pitcherSeason?.year ?? '—'} season` : ''}
        mod={pitcherMod ? `PIT ${fmtMod(pitcherMod.mod)}` : ''}
        fatigue={pitcherFatigueValue !== 0 ? `fatigue ${fmtMod(pitcherFatigueValue)}` : undefined}
        fatigueTitle={pitcherFatiguedInnings > 0 ? `${pitcherFatiguedInnings} fatigued inning${pitcherFatiguedInnings === 1 ? '' : 's'}` : undefined}
        photoId={pitcher ? photos[pitcher.id] : undefined}
        accent="var(--color-navy)"
        stats={
          pitching
            ? [
                ['ERA', pitching.era === null ? '—' : pitching.era.toFixed(2)],
                ['IP', formatIp(pitching.ipOuts)],
                ['G', String(pitching.games)],
              ]
            : []
        }
        today={pitcherToday && (pitcherToday.bf > 0 || pitcherToday.outs > 0) ? formatPitchingLine(pitcherToday) : 'Fresh on the mound'}
        onZoom={pitcher && onZoom ? () => onZoom(defense.side, pitcher) : undefined}
      />
    </div>
  );
}

function MatchupSide({
  label,
  name,
  sub,
  mod,
  fatigue,
  fatigueTitle,
  photoId,
  accent,
  stats,
  today,
  onZoom,
}: {
  label: string;
  name: string;
  sub: string;
  mod: string;
  /** a second, amber badge for a pitcher working on tired legs */
  fatigue?: string | undefined;
  fatigueTitle?: string | undefined;
  photoId?: number | null | undefined;
  accent: string;
  /** the season the dice are reading, as [label, value] pairs */
  stats: [string, string][];
  /** what he has done so far in this game */
  today: string;
  onZoom?: (() => void) | undefined;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-2.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!onZoom}
          onClick={onZoom}
          className="shrink-0 rounded enabled:cursor-zoom-in enabled:hover:ring-2 enabled:hover:ring-gold/60"
          title={onZoom ? `Zoom in on ${name}'s card` : undefined}
        >
          {photoId ? (
            <img src={`/api/photos/${photoId}`} alt="" className="h-14 w-10 rounded object-cover ring-1 ring-white/20" />
          ) : (
            <span className="grid h-14 w-10 place-items-center rounded bg-white/5 font-display text-lg text-chalk/50">{name.slice(0, 1)}</span>
          )}
        </button>
        <div className="min-w-0">
          <p className="text-[10px] tracking-wide text-chalk/45 uppercase">{label}</p>
          <button type="button" disabled={!onZoom} onClick={onZoom} className="block max-w-full truncate text-left font-medium text-chalk enabled:hover:text-gold">
            {name}
          </button>
          <p className="truncate font-mono text-[11px] text-chalk/50">{sub}</p>
        </div>
        {mod || fatigue ? (
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {mod ? (
              <span className="rounded-full px-2 py-0.5 font-mono text-xs font-bold text-chalk" style={{ background: accent }}>
                {mod}
              </span>
            ) : null}
            {fatigue ? (
              <span
                title={fatigueTitle}
                className="rounded-full bg-amber-400/20 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-300"
              >
                {fatigue}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      {stats.length ? (
        <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px]">
          {stats.map(([k, v]) => (
            <div key={k} className="flex gap-1">
              <dt className="text-chalk/40">{k}</dt>
              <dd className="text-chalk/85">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="mt-1.5 border-t border-white/10 pt-1.5 text-xs text-chalk/80">
        <span className="mr-1.5 text-[10px] tracking-wide text-chalk/40 uppercase">Today</span>
        <span className="font-mono">{today}</span>
      </p>
    </div>
  );
}

const shortName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? (parts[parts.length - 1] ?? name) : name;
};

/**
 * The ball in flight: a cream dot traveling from where it was hit to wherever
 * the dice sent it, at a pace the contact type sets — a liner snaps, a fly
 * ball hangs, a grounder hops through. A puff marks where a hit lands, and a
 * home run fades as it leaves the park. Reduced motion skips the flight and
 * shows the ball where the play ends.
 */
function BallFlight({ leg }: { leg: FlightLeg }) {
  const reduced = useReducedMotion();
  if (reduced) {
    return (
      <span
        aria-hidden
        className="pointer-events-none absolute z-20 h-[1.5cqw] min-h-[6px] w-[1.5cqw] min-w-[6px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-chalk/80"
        style={{ left: `${leg.to.x}%`, top: `${pctY(leg.to.y)}%` }}
      />
    );
  }
  // Repeat the endpoint for the hang times (a pop-up holds where it lands).
  const stops: Point[] = [leg.from, ...Array(leg.times.length - 1).fill(leg.to)];
  // When the ball reaches its man: the second keyframe's fraction of the run.
  const arrivalSec = leg.seconds * (leg.times[1] ?? 1);
  return (
    <>
      <motion.span
        key={leg.key}
        aria-hidden
        className="pointer-events-none absolute z-20 h-[1.5cqw] min-h-[6px] w-[1.5cqw] min-w-[6px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-chalk shadow-md"
        initial={{ left: `${leg.from.x}%`, top: `${pctY(leg.from.y)}%` }}
        animate={{
          left: stops.map((p) => `${p.x}%`),
          top: stops.map((p) => `${pctY(p.y)}%`),
          opacity: leg.fades ? [1, 1, 0] : 1,
        }}
        transition={{
          left: { duration: leg.seconds, ease: 'linear', times: leg.times },
          top: { duration: leg.seconds, ease: 'linear', times: leg.times },
          opacity: leg.fades ? { duration: leg.seconds, times: [0, 0.75, 1] } : { duration: 0 },
        }}
      />
      {leg.puff ? (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute z-10 h-[4cqw] w-[4cqw] -translate-x-1/2 -translate-y-1/2 rounded-full border-[0.35cqw] border-chalk/80"
          style={{ left: `${leg.to.x}%`, top: `${pctY(leg.to.y)}%` }}
          initial={{ scale: 0.3, opacity: 0 }}
          animate={{ scale: [0.3, 1.4, 1.9], opacity: [0, 0.75, 0] }}
          transition={{ duration: 0.5, delay: arrivalSec, ease: 'easeOut' }}
        />
      ) : null}
    </>
  );
}

/**
 * The field itself, from the press box: stands behind the fence, mown
 * outfield grass, darker foul ground, the infield skin, the grass square
 * inside the basepaths, chalk foul lines and batter's boxes, the mound, and
 * the bases. Occupied bases glow so a glance answers "who's on?".
 */
function FieldArt({ occupied }: { occupied: (1 | 2 | 3)[] }) {
  const { x: hx, y: hy } = HOME_PLATE;
  // Where the foul lines meet the fence, 45° out from the plate.
  const pole = FENCE_R / Math.SQRT2;
  const fence = `M${hx - pole} ${hy - pole} A${FENCE_R} ${FENCE_R} 0 0 1 ${hx + pole} ${hy - pole}`;
  const b1 = BASE_SPOTS[1];
  const b2 = BASE_SPOTS[2];
  const b3 = BASE_SPOTS[3];
  // The grass square, inset from the basepaths so a ribbon of dirt shows.
  const inset = 2.4;
  const grassSquare = `M${hx} ${hy - inset * 1.6} L${b1.x - inset * 1.6} ${b1.y} L${b2.x} ${b2.y + inset * 1.6} L${b3.x + inset * 1.6} ${b3.y} Z`;

  return (
    <svg viewBox="0 0 100 75" className="absolute inset-0 h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id="mat-grass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1f7049" />
          <stop offset="100%" stopColor="#175c3c" />
        </linearGradient>
        <pattern id="mat-mow" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3.5" height="7" fill="#ffffff" opacity="0.045" />
        </pattern>
        <radialGradient id="mat-dirt" cx="50%" cy="60%" r="60%">
          <stop offset="0%" stopColor="#c4935d" />
          <stop offset="100%" stopColor="#a8784a" />
        </radialGradient>
        <clipPath id="mat-fair">
          <path d={`M${hx} ${hy} L${hx - pole - 20} ${hy - pole - 20} L${hx + pole + 20} ${hy - pole - 20} Z`} />
        </clipPath>
      </defs>

      {/* the stands, all the way around */}
      <rect width="100" height="75" fill="#0c2a1e" />
      {Array.from({ length: 6 }, (_, i) => (
        <path
          key={i}
          d={`M${hx - pole - 6 - i * 2} ${hy - pole + 2 - i * 2} A${FENCE_R + 3 + i * 2.6} ${FENCE_R + 3 + i * 2.6} 0 0 1 ${hx + pole + 6 + i * 2} ${hy - pole + 2 - i * 2}`}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={0.05}
          strokeWidth="1"
          strokeDasharray="1.4 1"
        />
      ))}

      {/* foul ground, then the fair outfield inside the fence */}
      <path d={`M0 75 L0 ${hy - pole + 8} L${hx - pole} ${hy - pole} ${fence.slice(fence.indexOf('A'))} L100 ${hy - pole + 8} L100 75 Z`} fill="#155236" />
      <path d={`M${hx} ${hy} L${hx - pole} ${hy - pole} ${fence.slice(fence.indexOf('A'))} Z`} fill="url(#mat-grass)" />
      <path d={`M${hx} ${hy} L${hx - pole} ${hy - pole} ${fence.slice(fence.indexOf('A'))} Z`} fill="url(#mat-mow)" />
      {/* warning track and the wall */}
      <path d={fence} fill="none" stroke="#a8784a" strokeOpacity="0.55" strokeWidth="2.4" />
      <path d={fence} fill="none" stroke="#f6f2e6" strokeOpacity="0.7" strokeWidth="0.6" transform={`translate(0 -1.2)`} />

      {/* the infield skin: an arc around the mound, plus the dirt at the plate */}
      <circle cx={MOUND.x} cy={MOUND.y} r={BASE_GAP * 1.42} fill="url(#mat-dirt)" clipPath="url(#mat-fair)" />
      <circle cx={hx} cy={hy} r="5.4" fill="url(#mat-dirt)" />
      <path d={grassSquare} fill="#1f7049" />

      {/* dirt cutouts around the bags */}
      {[b1, b2, b3].map((b, i) => (
        <circle key={i} cx={b.x} cy={b.y} r="2.8" fill="#b7864f" />
      ))}

      {/* foul lines from the plate out to the poles, and the batter's boxes */}
      <path d={`M${hx} ${hy} L${hx - pole} ${hy - pole}`} stroke="#f6f2e6" strokeOpacity="0.85" strokeWidth="0.45" />
      <path d={`M${hx} ${hy} L${hx + pole} ${hy - pole}`} stroke="#f6f2e6" strokeOpacity="0.85" strokeWidth="0.45" />
      <rect x={hx - 5.4} y={hy - 2.4} width="3.2" height="4.8" fill="none" stroke="#f6f2e6" strokeOpacity="0.55" strokeWidth="0.3" />
      <rect x={hx + 2.2} y={hy - 2.4} width="3.2" height="4.8" fill="none" stroke="#f6f2e6" strokeOpacity="0.55" strokeWidth="0.3" />
      {/* foul poles */}
      <circle cx={hx - pole} cy={hy - pole} r="0.9" fill="#f2c94c" />
      <circle cx={hx + pole} cy={hy - pole} r="0.9" fill="#f2c94c" />

      {/* the mound and rubber */}
      <circle cx={MOUND.x} cy={MOUND.y} r="3.2" fill="#c99863" />
      <circle cx={MOUND.x} cy={MOUND.y} r="3.2" fill="none" stroke="#000" strokeOpacity="0.15" strokeWidth="0.3" />
      <rect x={MOUND.x - 1} y={MOUND.y - 0.3} width="2" height="0.6" fill="#f6f2e6" />

      {/* occupied bases glow, under the runner standing on them */}
      {occupied.map((base) => {
        const spot = BASE_SPOTS[base];
        return (
          <g key={base}>
            <circle cx={spot.x} cy={spot.y} r="4.6" fill="#d8a83c" opacity="0.22" />
            <circle cx={spot.x} cy={spot.y} r="4.6" fill="none" stroke="#d8a83c" strokeWidth="0.6" opacity="0.9" />
          </g>
        );
      })}

      {/* bases */}
      {[b1, b2, b3].map((b, i) => (
        <rect key={i} x={b.x - 1.3} y={b.y - 1.3} width="2.6" height="2.6" fill="#f6f2e6" transform={`rotate(45 ${b.x} ${b.y})`} />
      ))}
      {/* home plate */}
      <path d={`M${hx - 1.3} ${hy - 1.1} L${hx + 1.3} ${hy - 1.1} L${hx + 1.3} ${hy + 0.3} L${hx} ${hy + 1.4} L${hx - 1.3} ${hy + 0.3} Z`} fill="#f6f2e6" />
    </svg>
  );
}
