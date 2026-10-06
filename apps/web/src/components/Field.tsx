import type { EnginePlayer, GameState, Side } from '@cardball/engine';
import type { SeasonStats } from '@cardball/shared';
import {
  batterDue,
  batterPitchMod,
  cardSeasons,
  fieldingRating,
  fmtMod,
  getDefense,
  getOffense,
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
function seasonNow(player: EnginePlayer, yearRoll: number | null): SeasonStats | null {
  const seasons = cardSeasons(player);
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

export function Field({ state, photos }: { state: GameState; photos: Record<string, number> }) {
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
              lines={[shortName(runner.name), `SB ${fmtMod(runnerSbMod(seasonNow(runner, offense.yearRoll) ?? NEUTRAL_SEASON).mod)}`]}
            />
          );
        })}

        {/* home plate marker */}
        <div className="absolute -translate-x-1/2 -translate-y-1/2 text-[10px] font-bold tracking-widest text-chalk/45" style={{ left: '50%', top: '82%' }}>
          HOME
        </div>
      </div>

      <MatchupStrip state={state} pitcher={pitcher} photos={photos} />
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
}: {
  x: number;
  y: number;
  color: string;
  lines: string[];
  title: string;
  photoId?: number | null;
  ring?: boolean;
}) {
  return (
    <div
      className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-lg px-1.5 py-1 shadow-lg ring-1 ring-black/40 ${
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
    </div>
  );
}

/** The batter/pitcher matchup, with the pitch-roll modifiers on both sides. */
function MatchupStrip({
  state,
  pitcher,
  photos,
}: {
  state: GameState;
  pitcher: EnginePlayer | null;
  photos: Record<string, number>;
}) {
  const offense = getOffense(state);
  const defense = getDefense(state);
  const batter = state.currentPa ? offense.players.find((p) => p.id === state.currentPa!.batterId) ?? batterDue(state) : batterDue(state);
  const batterSeason = batter ? seasonNow(batter, offense.yearRoll) : null;
  const batterMod = batterSeason ? batterPitchMod(batterSeason) : null;
  const pitcherSeason = pitcher ? seasonNow(pitcher, defense.yearRoll) : null;
  const pitcherMod = pitcherSeason ? pitcherPitchMod(pitcherSeason) : null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <MatchupSide
        label={`At bat · ${offense.name}`}
        name={batter?.name ?? '—'}
        sub={batter ? `${batter.cardYear} · ${batterSeason?.year ?? ''} season` : ''}
        mod={batterMod ? `HIT ${fmtMod(batterMod.mod)}` : ''}
        photoId={batter ? photos[batter.id] : undefined}
        accent="var(--color-crimson)"
      />
      <MatchupSide
        label={`On the mound · ${getDefense(state).name}`}
        name={pitcher?.name ?? '—'}
        sub={pitcher ? `${pitcher.pitchingRole ?? ''} · ${pitcher.outsPitched} outs thrown` : ''}
        mod={pitcherMod ? `PIT ${fmtMod(pitcherMod.mod)}` : ''}
        photoId={pitcher ? photos[pitcher.id] : undefined}
        accent="var(--color-navy)"
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
}: {
  label: string;
  name: string;
  sub: string;
  mod: string;
  photoId?: number | null;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/25 p-2.5">
      {photoId ? (
        <img src={`/api/photos/${photoId}`} alt="" className="h-14 w-10 rounded object-cover ring-1 ring-white/20" />
      ) : (
        <span className="grid h-14 w-10 place-items-center rounded bg-white/5 font-display text-lg text-chalk/50">{name.slice(0, 1)}</span>
      )}
      <div className="min-w-0">
        <p className="text-[10px] tracking-wide text-chalk/45 uppercase">{label}</p>
        <p className="truncate font-medium text-chalk">{name}</p>
        <p className="truncate font-mono text-[11px] text-chalk/50">{sub}</p>
      </div>
      {mod ? (
        <span className="ml-auto shrink-0 rounded-full px-2 py-0.5 font-mono text-xs font-bold text-chalk" style={{ background: accent }}>
          {mod}
        </span>
      ) : null}
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
