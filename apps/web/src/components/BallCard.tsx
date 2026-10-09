import { useState } from 'react';
import type { SyntheticEvent } from 'react';
import type { CardSnapshot, DraftRarity } from '@cardball/shared';
import { activeHouseRules, hitMod, pitMod, sbMod, scoutingNotes, whipOf } from '@cardball/shared';
import { formatIp } from '@cardball/engine';
import { ROLE_LABEL, ROLE_POSE, SilhouetteGroup, silhouetteRole } from './Silhouette.js';
import type { SilhouetteRole } from './Silhouette.js';

/**
 * The Ball Card, drawn from real stats.
 *
 * The front is a framed card face in the team's colors: the player's own photo
 * when he has one, and otherwise original art (his position's silhouette
 * against a sunburst and a grandstand), a name ribbon, and a home-plate stamp
 * showing his role. The back carries the six-season stat window that the rules
 * actually read, with each season's dice modifier shown.
 *
 * Everything is sized in `cqw` units against the card's own width, so one
 * component scales from a thumbnail to a tabletop card.
 */

export type CardFace = 'front' | 'back';

interface BallCardProps {
  card: CardSnapshot;
  photoId?: number | null;
  /** the collection entry's rarity label ("Refractor", "Rookie"), when it has one */
  rarity?: string | null;
  /** stat-based tier; rare and up get a foil finish on the front */
  tier?: DraftRarity | null;
  face?: CardFace;
  className?: string;
}

/** The ring a card wears on its edge, one step per printed tier. */
const RING: Record<DraftRarity, string> = {
  common: 'ring-1 ring-black/25',
  uncommon: 'ring-1 ring-emerald-200/25',
  rare: 'ring-2 ring-sky-300/50',
  star: 'ring-2 ring-gold/80',
  mythic: 'ring-2 ring-fuchsia-400/80',
};

/** The foil finish on the front, one per tier; common and uncommon stay plain. */
const FOIL: Partial<Record<DraftRarity, string>> = { rare: 'foil-rare', star: 'foil-star', mythic: 'foil-mythic' };

/** Deterministic team colors, so the same franchise always looks the same. */
export type TeamColors = { primary: string; secondary: string; accent: string; glow: string };

export function teamColors(label: string): TeamColors {
  let hash = 0;
  const key = label || 'Cardball';
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 360;
  const hue = hash;
  return {
    primary: `hsl(${hue} 52% 30%)`,
    secondary: `hsl(${(hue + 28) % 360} 46% 22%)`,
    accent: `hsl(${(hue + 190) % 360} 60% 62%)`,
    /** a light tint of the team's own hue, for the sunburst behind a player */
    glow: `hsl(${(hue + 14) % 360} 58% 70%)`,
  };
}

const fmtAvg = (avg: number | null) => (avg === null ? '—' : avg.toFixed(3).replace(/^0/, ''));
const fmtMod = (mod: number) => (mod > 0 ? `+${mod}` : String(mod));

export function BallCard({ card, photoId, rarity, tier, face = 'front', className = '' }: BallCardProps) {
  const colors = teamColors(card.teamLabel);
  const ring = RING[tier ?? 'common'];
  const shell = `@container relative aspect-[5/7] w-full overflow-hidden rounded-[var(--radius-card)] card-stock text-ink shadow-[0_18px_40px_-18px_rgba(0,0,0,0.8)] select-none ${ring}`;

  return (
    <div className={`${shell} ${className}`} style={{ containerType: 'inline-size' }}>
      {face === 'front' ? (
        <CardFront card={card} photoId={photoId} rarity={rarity} tier={tier ?? null} colors={colors} />
      ) : (
        <CardBack card={card} colors={colors} tier={tier ?? null} />
      )}
      {face === 'front' && tier && FOIL[tier] ? (
        <div aria-hidden className={`pointer-events-none absolute inset-0 ${FOIL[tier]}`} />
      ) : null}
    </div>
  );
}

/**
 * The uploaded photo in the art window. A vertical card fills it; a
 * horizontal card would lose its sides to a portrait crop, so it is shown
 * whole over a blurred copy of itself.
 */
function CardPhoto({ photoId, alt }: { photoId: number; alt: string }) {
  const [landscape, setLandscape] = useState(false);
  const src = `/api/photos/${photoId}`;
  const onLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setLandscape(img.naturalWidth > img.naturalHeight);
  };
  if (!landscape) return <img src={src} alt={alt} className="h-full w-full object-cover" loading="lazy" onLoad={onLoad} />;
  return (
    <>
      <img src={src} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover blur-md brightness-75" />
      <img src={src} alt={alt} className="relative h-full w-full object-contain" onLoad={onLoad} />
    </>
  );
}

function CardFront({
  card,
  photoId,
  rarity,
  tier,
  colors,
}: {
  card: CardSnapshot;
  photoId?: number | null;
  rarity?: string | null;
  tier: DraftRarity | null;
  colors: TeamColors;
}) {
  const role = silhouetteRole(card);
  const fieldPositions = card.positions.filter((p) => p !== 'DH');
  const posLine = card.pitcherClass
    ? card.pitcherClass === 'SP'
      ? 'Starting pitcher'
      : 'Relief pitcher'
    : fieldPositions.length
      ? fieldPositions.slice(0, 4).join(' · ')
      : 'Designated hitter';

  return (
    // The team-color frame around everything, the way a printed border sits
    // inside the card's white edge.
    <div className="flex h-full flex-col p-[3.2cqw]" style={{ background: `linear-gradient(160deg, ${colors.primary}, ${colors.secondary})` }}>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[2.4cqw] ring-[0.8cqw] ring-chalk/85">
        {photoId ? (
          <CardPhoto photoId={photoId} alt={`${card.name} card`} />
        ) : (
          <CardArt name={card.name} role={role} colors={colors} />
        )}

        {/* team and year across the top of the art */}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-[2.4cqw]">
          <span
            className="max-w-[62%] truncate rounded-[1cqw] px-[2cqw] py-[0.6cqw] font-display text-[4.2cqw] leading-none font-bold tracking-[0.12em] text-chalk uppercase italic shadow-sm"
            style={{ background: colors.secondary }}
          >
            {card.teamLabel || 'Cardball'}
          </span>
          <span className="rounded-[1cqw] bg-black/45 px-[1.6cqw] py-[0.6cqw] font-mono text-[3.4cqw] leading-none font-bold text-chalk tabular-nums">
            {card.cardYear}
          </span>
        </div>

        {rarity ? (
          <span
            className="absolute top-[10cqw] right-[2.4cqw] z-10 rounded-full px-[2.4cqw] py-[0.8cqw] text-[2.6cqw] font-bold tracking-wider text-ink uppercase shadow"
            style={{ background: tier === 'mythic' ? 'linear-gradient(120deg,#e79ab4,#8a5fc4)' : 'var(--color-gold)' }}
          >
            {tier === 'mythic' ? '✦ ' : tier === 'star' ? '★ ' : ''}
            {rarity}
          </span>
        ) : null}
      </div>

      {/* the name ribbon, with the role badge breaking into it */}
      <div className="relative mt-[2.4cqw] flex items-center gap-[2.4cqw]">
        <RoleBadge role={role} colors={colors} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[6.6cqw] leading-none font-bold text-chalk drop-shadow-[0_1px_0_rgba(0,0,0,0.5)]">{card.name}</div>
          <div className="mt-[1.2cqw] flex items-center justify-between gap-[2cqw] font-mono text-[2.8cqw] leading-none text-chalk/80">
            <span className="truncate uppercase">{posLine}</span>
            <span className="shrink-0">{card.bats || card.throws ? `B/T ${card.bats ?? '?'}/${card.throws ?? '?'}` : card.canBat ? 'hits' : 'no bat'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The position stamp on the card front: a home-plate shield with the role. */
function RoleBadge({ role, colors }: { role: SilhouetteRole; colors: { primary: string; accent: string } }) {
  return (
    <svg viewBox="0 0 40 44" className="h-[12cqw] w-[11cqw] shrink-0 drop-shadow" aria-label={`${ROLE_LABEL[role]} card`} role="img">
      <path d="M3 3 H37 V27 L20 41 L3 27 Z" fill="#f6f2e6" />
      <path d="M6.5 6.5 H33.5 V25.4 L20 36.6 L6.5 25.4 Z" fill={colors.primary} />
      <text x="20" y="25" textAnchor="middle" fontFamily="ui-serif, Georgia, serif" fontSize={ROLE_LABEL[role].length > 1 ? 15 : 19} fontWeight="800" fill="#f6f2e6">
        {ROLE_LABEL[role]}
      </text>
    </svg>
  );
}

/**
 * Original art for a card without a photo: the player's position silhouette
 * against a sunburst in his team's colors, a grandstand behind him and the
 * dirt under his spikes. The name seeds small variations so two cards from
 * one team don't look stamped from the same plate.
 */
function CardArt({ name, role, colors }: { name: string; role: SilhouetteRole; colors: TeamColors }) {
  let seed = 0;
  for (let i = 0; i < name.length; i++) seed = (seed * 17 + name.charCodeAt(i)) % 997;
  const id = `art-${seed}-${role}`;
  const rayTilt = (seed % 12) - 6;
  const standTop = 68 + (seed % 6);
  const rays = 18;

  return (
    <svg viewBox="0 0 100 120" preserveAspectRatio="xMidYMax slice" className="h-full w-full" role="img" aria-label={`${name}, ${ROLE_LABEL[role]}`}>
      <defs>
        <radialGradient id={`${id}-sky`} cx="50%" cy="48%" r="70%">
          <stop offset="0%" stopColor={colors.glow} />
          <stop offset="55%" stopColor={colors.primary} />
          <stop offset="100%" stopColor={colors.secondary} />
        </radialGradient>
        <linearGradient id={`${id}-dirt`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c99863" />
          <stop offset="100%" stopColor="#8f6236" />
        </linearGradient>
      </defs>

      <rect width="100" height="120" fill={`url(#${id}-sky)`} />
      {/* sunburst */}
      <g transform={`rotate(${rayTilt} 50 58)`} opacity="0.16">
        {Array.from({ length: rays }, (_, i) => {
          const a0 = (i / rays) * Math.PI * 2;
          const a1 = a0 + Math.PI / rays;
          return (
            <path
              key={i}
              d={`M50 58 L${50 + Math.cos(a0) * 140} ${58 + Math.sin(a0) * 140} L${50 + Math.cos(a1) * 140} ${58 + Math.sin(a1) * 140} Z`}
              fill="#f6f2e6"
            />
          );
        })}
      </g>
      {/* the grandstand and its light towers */}
      <path d={`M0 ${standTop} Q50 ${standTop - 10} 100 ${standTop} L100 98 L0 98 Z`} fill={colors.secondary} opacity="0.9" />
      {Array.from({ length: 3 }, (_, row) => (
        <path
          key={row}
          d={`M0 ${standTop + 4 + row * 5} Q50 ${standTop - 6 + row * 5} 100 ${standTop + 4 + row * 5}`}
          stroke="#f6f2e6"
          strokeOpacity="0.14"
          strokeWidth="1.2"
          strokeDasharray="2 1.6"
          fill="none"
        />
      ))}
      {[12, 88].map((x) => (
        <g key={x} opacity="0.55">
          <rect x={x - 0.6} y={standTop - 26} width="1.2" height="26" fill={colors.secondary} />
          <rect x={x - 4.5} y={standTop - 30} width="9" height="5" rx="0.8" fill="#f6f2e6" opacity="0.9" />
        </g>
      ))}
      {/* the grass, then the dirt he stands on */}
      <path d="M0 92 Q50 84 100 92 L100 120 L0 120 Z" fill="#1d6a47" />
      <ellipse cx="50" cy="112" rx="46" ry="11" fill={`url(#${id}-dirt)`} />
      <ellipse cx="50" cy="111" rx="26" ry="4" fill="#000" opacity="0.18" />

      {/* the player: a chalk rim, then the silhouette in deep ink */}
      <g transform="translate(5 18) scale(0.92)">
        <SilhouetteGroup pose={ROLE_POSE[role]} fill="#f6f2e6" grow={1.6} />
        <SilhouetteGroup pose={ROLE_POSE[role]} fill="#15140f" />
      </g>
    </svg>
  );
}

/**
 * The card back: the stat window the dice actually read.
 *
 * A card with a pitcher class wears the pitching back (YR/ERA/IP/K/BB/WHIP/W/L,
 * plus SV for a reliever) even when it could also bat; everyone else wears the
 * hitting back (YR/AVG/HIT/AB/HR/RBI/SB). Star and Mythic cards add a scouting
 * blurb drawn from their own seasons, the way a real card carries trivia.
 */
function CardBack({ card, colors, tier }: { card: CardSnapshot; colors: { primary: string; secondary: string }; tier: DraftRarity | null }) {
  const rows = card.seasons;
  // The back prints the modifiers the dice will actually use, so it reads the
  // commissioner's current house rules rather than a hardcoded band.
  const rules = activeHouseRules();
  const pitchingBack = card.pitcherClass !== null;
  const reliever = card.pitcherClass === 'RP';
  const notes = tier === 'star' || tier === 'mythic' ? scoutingNotes(card) : [];

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-baseline justify-between px-[4cqw] pt-[3cqw] pb-[2cqw] text-chalk"
        style={{ background: `linear-gradient(100deg, ${colors.primary}, ${colors.secondary})` }}
      >
        <span className="truncate font-display text-[clamp(13px,4.4cqw,22px)] font-semibold">{card.name}</span>
        <span className="shrink-0 pl-[2cqw] font-mono text-[clamp(11px,3.2cqw,16px)] opacity-90">{card.cardYear}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden px-[2.6cqw] py-[2.4cqw]">
        {rows.length === 0 ? (
          <p className="px-[1cqw] text-[clamp(11px,3cqw,16px)] text-ink-soft">No seasons on this card back.</p>
        ) : (
          <table className="w-full border-collapse font-mono text-[clamp(12px,2.9cqw,17px)] tabular-nums">
            <thead>
              <tr className="text-ink-soft">
                <th className="text-left font-sans font-semibold">YR</th>
                {pitchingBack ? (
                  <>
                    <th className="text-right font-sans font-semibold">ERA</th>
                    <th className="text-right font-sans font-semibold">IP</th>
                    <th className="text-right font-sans font-semibold">K</th>
                    <th className="text-right font-sans font-semibold">BB</th>
                    <th className="text-right font-sans font-semibold">WHIP</th>
                    <th className="text-right font-sans font-semibold">W</th>
                    <th className="text-right font-sans font-semibold">L</th>
                    {reliever ? <th className="text-right font-sans font-semibold">SV</th> : null}
                  </>
                ) : (
                  <>
                    <th className="text-right font-sans font-semibold">AVG</th>
                    <th className="text-right font-sans font-semibold">HIT</th>
                    <th className="text-right font-sans font-semibold">AB</th>
                    <th className="text-right font-sans font-semibold">HR</th>
                    <th className="text-right font-sans font-semibold">RBI</th>
                    <th className="text-right font-sans font-semibold">SB</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.year} className="border-t border-ink/10">
                  <td className="py-[0.5cqw] text-left">{String(s.year).slice(2)}</td>
                  {pitchingBack ? (
                    <>
                      <td className="text-right">
                        {s.pitching ? (
                          <>
                            {s.pitching.era === null ? '—' : s.pitching.era.toFixed(2)}
                            <span className="pl-[0.8cqw] font-bold" style={{ color: 'var(--color-navy)' }}>
                              {fmtMod(pitMod(s.pitching.era, rules.pitBands))}
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="text-right">{s.pitching ? formatIp(s.pitching.ipOuts) : '—'}</td>
                      <td className="text-right">{s.pitching?.so ?? 0}</td>
                      <td className="text-right">{s.pitching?.bb ?? 0}</td>
                      <td className="text-right">{s.pitching ? whipOf(s) : '—'}</td>
                      <td className="text-right">{s.pitching?.w ?? 0}</td>
                      <td className="text-right">{s.pitching?.l ?? 0}</td>
                      {reliever ? <td className="text-right">{s.pitching?.sv ?? 0}</td> : null}
                    </>
                  ) : (
                    <>
                      <td className="text-right">{fmtAvg(s.avg)}</td>
                      <td className="text-right font-bold" style={{ color: 'var(--color-crimson)' }}>
                        {s.ab >= rules.fullGameAb ? fmtMod(hitMod(s.avg, rules.hitBands)) : '·'}
                      </td>
                      <td className="text-right">{s.ab}</td>
                      <td className="text-right">{s.homeRuns}</td>
                      <td className="text-right">{s.rbi}</td>
                      <td className="text-right">
                        {s.sb}
                        <span className="pl-[0.8cqw] font-bold" style={{ color: 'var(--color-navy)' }}>
                          {fmtMod(sbMod(s.sb, rules.sbBands))}
                        </span>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-[2cqw] grid grid-cols-2 gap-x-[2cqw] gap-y-[0.6cqw] font-mono text-[clamp(10px,2.7cqw,14px)] text-ink-soft">
          {!pitchingBack
            ? rows
                .filter((s) => s.pitching && s.pitching.ipOuts > 0)
                .slice(-1)
                .map((s) => (
                  <span key={s.year}>
                    {s.year} IP {formatIp(s.pitching!.ipOuts)}
                  </span>
                ))
            : null}
          {card.pitcherClass ? <span>role {card.pitcherClass}</span> : null}
          {card.fielding && Object.keys(card.fielding).length ? (
            <span className="col-span-2 truncate">
              FLD{' '}
              {Object.entries(card.fielding)
                .map(([pos, rating]) => `${pos} ${fmtMod(rating as number)}`)
                .join('  ')}
            </span>
          ) : null}
        </div>
      </div>

      {notes.length > 0 ? (
        <div className="border-t border-ink/10 bg-stock-dark/45 px-[3.5cqw] py-[1.8cqw]">
          <p className="font-mono text-[clamp(9px,2.4cqw,13px)] leading-snug text-ink-soft italic">{notes[0]}</p>
        </div>
      ) : null}

      <footer className="border-t border-ink/10 px-[4cqw] py-[2cqw] font-mono text-[clamp(10px,2.6cqw,13px)] text-ink-soft">
        {pitchingBack ? 'PIT from ERA · WHIP from hits + walks' : 'HIT from AVG · SB from steals'}
      </footer>
    </div>
  );
}
