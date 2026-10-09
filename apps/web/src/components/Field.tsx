import { memo, useRef } from 'react';
import { motion } from 'framer-motion';
import type { EnginePlayer, GameState, Side } from '@cardball/engine';
import type { HouseRules, SeasonStats } from '@cardball/shared';
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
import { teamColors } from './BallCard.js';

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

/**
 * The mat's coordinate system: a 100×75 viewBox (a 4:3 box, the same aspect
 * the container keeps). Everything below — the painted diamond and every chip —
 * is expressed in these units. Because the viewBox is 75 tall but CSS `top`
 * runs 0–100%, the chips convert y on the way out (see `pctY`), or they would
 * sit a quarter of the field too high.
 */
const VIEW_H = 75;
const pctY = (y: number) => (y / VIEW_H) * 100;

/** Home plate, second base, and the two bases on the foul lines. */
const HOME_PLATE = { x: 50, y: 64 };
const BASE_SPOTS: Record<1 | 2 | 3, { x: number; y: number }> = {
  1: { x: 70, y: 44 },
  2: { x: 50, y: 24 },
  3: { x: 30, y: 44 },
};

/**
 * Where a runner stands while he holds a base. Nudged a few units off the base
 * spot along the basepath toward home, so the white base and its glow ring
 * stay visible under the chip.
 */
const RUNNER_SPOTS: Record<1 | 2 | 3, { x: number; y: number }> = {
  1: { x: 66.5, y: 40.5 },
  2: { x: 50, y: 30.5 },
  3: { x: 33.5, y: 40.5 },
};

/** Where each defender stands: on the infield skin, outfielders in the grass. */
const FIELDER_SPOTS: Record<string, { x: number; y: number }> = {
  C: { x: 50, y: 70 },
  '1B': { x: 66, y: 43 },
  '2B': { x: 59, y: 36 },
  '3B': { x: 34, y: 43 },
  SS: { x: 41, y: 36 },
  LF: { x: 26, y: 22 },
  CF: { x: 50, y: 12 },
  RF: { x: 74, y: 22 },
  P: { x: 50, y: 45 },
};

/** Where the batter waits, in the left-hand batter's box beside the plate. */
const BATTER_BOX = { x: 42, y: 65 };

export type ZoomPlayer = (side: Side, player: EnginePlayer) => void;

/**
 * The mat. Runners slide along the basepaths between bases as the plays
 * resolve, the batter stands in the box, and occupied bases glow.
 */
export const Field = memo(function Field({ state, photos, onZoom }: { state: GameState; photos: Record<string, number>; onZoom?: ZoomPlayer }) {
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

  const fielders = defense.players.filter(
    (p): p is EnginePlayer & { fieldPosition: string } => p.status === 'active' && !!p.fieldPosition && p.fieldPosition !== 'DH',
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
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl ring-1 ring-black/40">
        <FieldArt occupied={occupied} />

        {/* defense */}
        {fielders.map((fielder) => {
          const spot = FIELDER_SPOTS[fielder.fieldPosition];
          if (!spot) return null;
          return (
            <Chip
              key={fielder.id}
              x={spot.x}
              y={spot.y}
              color={defenseColors.primary}
              title={`${fielder.fieldPosition} · ${fielder.name}`}
              photoId={photos[fielder.id]}
              onClick={onZoom ? () => onZoom(defense.side, fielder) : undefined}
              lines={[fielder.fieldPosition, shortName(fielder.name), fmtMod(fieldingRating(fielder, fielder.fieldPosition))]}
            />
          );
        })}

        {/* the batter, standing in */}
        {batter ? (
          <Chip
            key={`at-bat-${batter.id}`}
            x={BATTER_BOX.x}
            y={BATTER_BOX.y}
            color={offenseColors.primary}
            title={`At bat · ${batter.name}`}
            photoId={photos[batter.id]}
            onClick={onZoom ? () => onZoom(offense.side, batter) : undefined}
            lines={['AB', shortName(batter.name)]}
            ring
          />
        ) : null}

        {/* runners, sliding between bases as plays resolve */}
        {onBase.map((runner) => {
          const spot = RUNNER_SPOTS[runner.base as 1 | 2 | 3];
          if (!spot) return null;
          return (
            <Chip
              key={runner.id}
              x={spot.x}
              y={spot.y}
              from={firstPaint.current ? undefined : HOME_PLATE}
              color={offenseColors.primary}
              title={`${runner.name} on ${runner.base === 1 ? 'first' : runner.base === 2 ? 'second' : 'third'}`}
              photoId={photos[runner.id]}
              onClick={onZoom ? () => onZoom(offense.side, runner) : undefined}
              lines={[
                shortName(runner.name),
                `SB ${fmtMod(runnerSbMod(seasonNow(runner, offense.yearRoll, state.config.rules) ?? NEUTRAL_SEASON, state.config.rules).mod)}`,
              ]}
            />
          );
        })}
      </div>

      <MatchupStrip state={state} pitcher={pitcher} photos={photos} onZoom={onZoom} />
    </div>
  );
});

function Chip({
  x,
  y,
  from,
  color,
  lines,
  title,
  photoId,
  ring = false,
  onClick,
}: {
  x: number;
  y: number;
  /** where a runner springs in from (home plate); omit to appear in place */
  from?: { x: number; y: number };
  color: string;
  lines: string[];
  title: string;
  photoId?: number | null;
  ring?: boolean;
  onClick?: (() => void) | undefined;
}) {
  const label = (
    <>
      {photoId ? (
        <img src={`/api/photos/${photoId}`} alt="" className="h-6 w-4 rounded object-cover" />
      ) : (
        <span className="grid h-6 w-4 place-items-center rounded bg-black/30 font-mono text-[9px] font-bold text-chalk/80">{lines[0]}</span>
      )}
      <span className="flex flex-col leading-tight">
        <span className="text-[10px] font-semibold text-chalk">{lines[1]}</span>
        {lines[2] ? <span className="font-mono text-[9px] text-chalk/70">{lines[2]}</span> : null}
      </span>
    </>
  );

  if (from) {
    return (
      <motion.button
        type="button"
        disabled={!onClick}
        onClick={onClick}
        className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left shadow-lg ring-1 ring-black/40 enabled:cursor-zoom-in enabled:hover:brightness-125 ${
          ring ? 'ring-2 ring-gold/70' : ''
        }`}
        style={{ background: color }}
        title={title}
        aria-label={title}
        initial={{ left: `${from.x}%`, top: `${pctY(from.y)}%`, opacity: 0, scale: 0.6 }}
        animate={{ left: `${x}%`, top: `${pctY(y)}%`, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 180, damping: 22 }}
      >
        {label}
      </motion.button>
    );
  }

  return (
    <motion.button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left shadow-lg ring-1 ring-black/40 enabled:cursor-zoom-in enabled:hover:brightness-125 ${
        ring ? 'ring-2 ring-gold/70' : ''
      }`}
      style={{ background: color, left: `${x}%`, top: `${pctY(y)}%` }}
      title={title}
      aria-label={title}
      initial={false}
    >
      {label}
    </motion.button>
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
 * The mat itself: mown outfield grass, the infield skin inside the foul lines,
 * a grass diamond between the bases, chalk lines through first and third, and
 * the bases. Occupied bases glow so a glance answers "who's on?".
 */
function FieldArt({ occupied }: { occupied: (1 | 2 | 3)[] }) {
  return (
    <svg viewBox="0 0 100 75" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id="mat-grass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1d6a47" />
          <stop offset="100%" stopColor="#124a33" />
        </linearGradient>
        <pattern id="mat-mow" width="8" height="75" patternUnits="userSpaceOnUse">
          <rect width="4" height="75" fill="#ffffff" opacity="0.03" />
        </pattern>
      </defs>

      {/* outfield grass, mown in stripes */}
      <rect width="100" height="75" fill="url(#mat-grass)" />
      <rect width="100" height="75" fill="url(#mat-mow)" />

      {/* outfield wall, pushed back behind the foul poles so they sit in front */}
      <path d="M0 24 Q50 -2 100 24 L100 0 L0 0 Z" fill="#0b2f21" opacity="0.85" />
      <path d="M0 24 Q50 -2 100 24" fill="none" stroke="#f6f2e6" strokeOpacity="0.5" strokeWidth="0.5" />

      {/* the infield skin: the area inside the foul lines, rounded behind second */}
      <path
        d="M50 64 L78 36 Q74 20 50 18 Q26 20 22 36 Z"
        fill="#b4834f"
        opacity="0.95"
      />

      {/* the grass diamond between the bases; its edges ARE the basepaths */}
      <path d="M50 64 L70 44 L50 24 L30 44 Z" fill="#1a6344" />

      {/* foul lines run from the plate through first and third into the outfield */}
      <path d="M50 64 L94 20" stroke="#f6f2e6" strokeOpacity="0.75" strokeWidth="0.4" />
      <path d="M50 64 L6 20" stroke="#f6f2e6" strokeOpacity="0.75" strokeWidth="0.4" />
      {/* the basepaths themselves, chalked over the grass diamond */}
      <path d="M50 64 L70 44 L50 24 L30 44 Z" fill="none" stroke="#f6f2e6" strokeOpacity="0.45" strokeWidth="0.3" />

      {/* the mound */}
      <ellipse cx="50" cy="45" rx="4.5" ry="2.4" fill="#c08c56" />
      <ellipse cx="50" cy="45" rx="4.5" ry="2.4" fill="none" stroke="#f6f2e6" strokeOpacity="0.25" strokeWidth="0.25" />

      {/* bases: first and third on the foul lines, second on the centre line */}
      {(
        [
          [70, 44],
          [50, 24],
          [30, 44],
        ] as const
      ).map(([x, y], i) => (
        <rect key={i} x={x - 1.7} y={y - 1.7} width="3.4" height="3.4" fill="#f6f2e6" transform={`rotate(45 ${x} ${y})`} />
      ))}
      {/* occupied bases glow */}
      {occupied.map((base) => {
        const spot = BASE_SPOTS[base];
        return <circle key={base} cx={spot.x} cy={spot.y} r="3.6" fill="none" stroke="#d8a83c" strokeWidth="0.7" opacity="0.9" />;
      })}
      {/* home plate */}
      <path d="M48.6 62.6 L51.4 62.6 L51.4 64.6 L50 65.6 L48.6 64.6 Z" fill="#f6f2e6" />
    </svg>
  );
}
