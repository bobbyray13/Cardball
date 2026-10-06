import type { EnginePlayer, GameState, Side } from '@cardball/engine';
import type { SeasonStats } from '@cardball/shared';
import type { HouseRules } from '@cardball/shared';
import { formatBattingLine, formatPitchingLine } from '@cardball/shared';
import {
  batterDue,
  batterPitchMod,
  cardSeasons,
  fieldingRating,
  fmtMod,
  formatIp,
  getDefense,
  getOffense,
  lineFor,
  pitcherPitchMod,
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

/** Where each fielder stands on the mat, as a percentage of the container. */
const FIELDER_SPOTS: Record<string, { x: number; y: number }> = {
  C: { x: 50, y: 93 },
  '1B': { x: 82, y: 68 },
  '2B': { x: 63, y: 50 },
  '3B': { x: 19, y: 68 },
  SS: { x: 37, y: 50 },
  LF: { x: 13, y: 30 },
  CF: { x: 50, y: 15 },
  RF: { x: 87, y: 30 },
  P: { x: 50, y: 63 },
};

const BASE_SPOTS: Record<1 | 2 | 3, { x: number; y: number }> = {
  1: { x: 76, y: 70 },
  2: { x: 50, y: 52 },
  3: { x: 24, y: 70 },
};

export type ZoomPlayer = (side: Side, player: EnginePlayer) => void;

export function Field({ state, photos, onZoom }: { state: GameState; photos: Record<string, number>; onZoom?: ZoomPlayer }) {
  const defense = getDefense(state);
  const offense = getOffense(state);
  const defenseColors = teamColors(defense.name);
  const offenseColors = teamColors(offense.name);

  const fielders = defense.players.filter(
    (p): p is EnginePlayer & { fieldPosition: string } => p.status === 'active' && !!p.fieldPosition && p.fieldPosition !== 'DH',
  );
  const pitcher = defense.players.find((p) => p.id === defense.activePitcherId) ?? null;
  const onBase = runnersOn(offense);

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl ring-1 ring-black/40">
        <FieldArt />

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

        {/* runners */}
        {onBase.map((runner) => {
          const spot = BASE_SPOTS[runner.base as 1 | 2 | 3];
          if (!spot) return null;
          return (
            <Chip
              key={runner.id}
              x={spot.x}
              y={spot.y}
              color={offenseColors.primary}
              ring
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

        {/* home plate marker */}
        <div className="absolute -translate-x-1/2 -translate-y-1/2 text-[10px] font-bold tracking-widest text-chalk/45" style={{ left: '50%', top: '82%' }}>
          HOME
        </div>
      </div>

      <MatchupStrip state={state} pitcher={pitcher} photos={photos} onZoom={onZoom} />
    </div>
  );
}

function Chip({
  x,
  y,
  color,
  lines,
  title,
  photoId,
  ring = false,
  onClick,
}: {
  x: number;
  y: number;
  color: string;
  lines: string[];
  title: string;
  photoId?: number | null;
  ring?: boolean;
  onClick?: (() => void) | undefined;
}) {
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left shadow-lg ring-1 ring-black/40 enabled:cursor-zoom-in enabled:hover:brightness-125 ${
        ring ? 'ring-2 ring-gold/70' : ''
      }`}
      style={{ left: `${x}%`, top: `${y}%`, background: color }}
      title={title}
    >
      {photoId ? (
        <img src={`/api/photos/${photoId}`} alt="" className="h-6 w-4 rounded object-cover" />
      ) : (
        <span className="grid h-6 w-4 place-items-center rounded bg-black/30 font-mono text-[9px] font-bold text-chalk/80">{lines[0]}</span>
      )}
      <span className="flex flex-col leading-tight">
        <span className="text-[10px] font-semibold text-chalk">{lines[1]}</span>
        {lines[2] ? <span className="font-mono text-[9px] text-chalk/70">{lines[2]}</span> : null}
      </span>
    </button>
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
  const pitcherMod = pitcherSeason ? pitcherPitchMod(pitcherSeason, rules) : null;
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
        {mod ? (
          <span className="ml-auto shrink-0 rounded-full px-2 py-0.5 font-mono text-xs font-bold text-chalk" style={{ background: accent }}>
            {mod}
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

/** The mat itself: mown grass, a dirt infield, chalk lines, and the bases. */
function FieldArt() {  return (
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

      <rect width="100" height="75" fill="url(#mat-grass)" />
      <rect width="100" height="75" fill="url(#mat-mow)" />

      {/* outfield wall */}
      <path d="M0 30 Q50 6 100 30 L100 0 L0 0 Z" fill="#0b2f21" opacity="0.75" />
      <path d="M0 30 Q50 6 100 30" fill="none" stroke="#f6f2e6" strokeOpacity="0.45" strokeWidth="0.5" />

      {/* infield dirt */}
      <ellipse cx="50" cy="63" rx="34" ry="17" fill="#b4834f" opacity="0.9" />
      {/* grass diamond inside the dirt */}
      <path d="M50 47 L71 57 L50 68 L29 57 Z" fill="#1a6344" />

      {/* foul lines */}
      <path d="M50 70 L4 34" stroke="#f6f2e6" strokeOpacity="0.7" strokeWidth="0.4" />
      <path d="M50 70 L96 34" stroke="#f6f2e6" strokeOpacity="0.7" strokeWidth="0.4" />
      {/* infield dirt lines */}
      <path d="M50 70 L76 58" stroke="#f6f2e6" strokeOpacity="0.5" strokeWidth="0.3" />
      <path d="M50 70 L24 58" stroke="#f6f2e6" strokeOpacity="0.5" strokeWidth="0.3" />

      {/* bases */}
      {[
        [76, 58],
        [50, 47],
        [24, 58],
      ].map(([x, y], i) => (
        <rect key={i} x={x! - 1.6} y={y! - 1.6} width="3.2" height="3.2" fill="#f6f2e6" transform={`rotate(45 ${x} ${y})`} />
      ))}
      {/* home plate */}
      <path d="M48.6 68.6 L51.4 68.6 L51.4 70.6 L50 71.6 L48.6 70.6 Z" fill="#f6f2e6" />
      {/* mound */}
      <ellipse cx="50" cy="55" rx="4" ry="2" fill="#c08c56" />
    </svg>
  );
}
