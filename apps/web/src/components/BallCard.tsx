import { useId, useState } from 'react';
import type { SyntheticEvent } from 'react';
import type { CardSnapshot, DraftRarity } from '@cardball/shared';
import { activeHouseRules, hitMod, pitMod, sbMod, scoutingNotes, whipOf } from '@cardball/shared';
import { formatIp } from '@cardball/engine';
import { PAPER, mix, teamAbbr, teamPalette } from '../lib/teams.js';
import type { TeamPalette } from '../lib/teams.js';
import { ROLE_LABEL, ROLE_POSE, SilhouetteGroup, silhouetteRole } from './Silhouette.js';
import type { SilhouetteRole } from './Silhouette.js';

/**
 * The Ball Card, drawn from real stats.
 *
 * The front is the photo of the real card when someone has uploaded one, and
 * otherwise a vintage-style face printed in the club's colors: an inked frame
 * with corner ornaments, the player's name on an arched ribbon, his
 * position's silhouette in a ballpark scene, his positions on a lower ribbon,
 * and the team and year in the corners. The back carries the six-season stat
 * window that the rules actually read, with each season's dice modifier shown.
 *
 * Everything scales with the card's own width (an SVG face, `cqw` units on the
 * back), so one component serves from a thumbnail to a tabletop card.
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

/** Team colors: the club's real ones when we know the club, otherwise stable ones derived from the label. */
export type TeamColors = TeamPalette;
export const teamColors = teamPalette;

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

const POSITION_NAME: Record<string, string> = {
  C: 'Catcher',
  '1B': 'First Base',
  '2B': 'Second Base',
  '3B': 'Third Base',
  SS: 'Shortstop',
  LF: 'Left Field',
  CF: 'Center Field',
  RF: 'Right Field',
  DH: 'Designated Hitter',
};

/** The lower ribbon: his role spelled out, or his positions when he plays several. */
export function positionLine(card: Pick<CardSnapshot, 'pitcherClass' | 'positions'>): string {
  if (card.pitcherClass === 'SP') return 'Starting Pitcher';
  if (card.pitcherClass === 'RP') return 'Relief Pitcher';
  const field = card.positions.filter((p) => p !== 'DH' && p !== 'P');
  if (field.length === 0) return POSITION_NAME.DH!;
  if (field.length === 1) return POSITION_NAME[field[0]!] ?? field[0]!;
  return field.slice(0, 4).join(' · ');
}

const SEPIA = '#b9a37f';

const SLAB = "'Rockwell Extra Bold', 'Rockwell', 'Roboto Slab', 'Clarendon', Georgia, 'Times New Roman', serif";

/** Lettering that fits a ribbon: big for short names, smaller as they grow. */
const fitSize = (text: string, room: number, max: number, min: number, perChar = 0.7) =>
  Math.max(min, Math.min(max, room / (perChar * Math.max(1, text.length))));

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
  const rarityPill = rarity ? (
    <span
      className="absolute top-[3cqw] right-[3cqw] z-10 rounded-full px-[2.4cqw] py-[0.8cqw] text-[2.6cqw] font-bold tracking-wider text-ink uppercase shadow"
      style={{ background: tier === 'mythic' ? 'linear-gradient(120deg,#e79ab4,#8a5fc4)' : 'var(--color-gold)' }}
    >
      {tier === 'mythic' ? '✦ ' : tier === 'star' ? '★ ' : ''}
      {rarity}
    </span>
  ) : null;

  // A photographed card already is the card: show it edge to edge.
  if (photoId) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-black">
        <CardPhoto photoId={photoId} alt={`${card.name} card`} />
        {rarityPill}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <VintageFront card={card} role={role} colors={colors} />
      {rarityPill}
    </div>
  );
}

/** One corner flourish, drawn for the top-left and mirrored into the others. */
function CornerOrnament({ ink, paper }: { ink: string; paper: string }) {
  return (
    <g>
      <path d="M0 0 H22 Q13 3 9.5 9.5 Q3 13 0 22 Z" fill={ink} />
      <path d="M4.2 11.5 Q4 4 11.5 4.2 Q8.4 6 8.6 8.6 Q6 8.4 4.2 11.5 Z" fill={paper} />
      <circle cx="9.6" cy="9.6" r="1.5" fill={paper} />
      <path d="M13.5 3.2 Q17 2.6 19 4.4 M3.2 13.5 Q2.6 17 4.4 19" stroke={paper} strokeWidth="0.9" fill="none" strokeLinecap="round" />
    </g>
  );
}

const star = (cx: number, cy: number, r: number) => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)},${(cy + Math.sin(a) * rr).toFixed(2)}`);
  }
  return pts.join(' ');
};

/**
 * The stock card face for a player without a photo, after the pre-war
 * tobacco and gum cards: an ornate inked frame, pinstriped side panels, an
 * arched name ribbon, and the player's silhouette on the mound of a sepia
 * ballpark, all inked and tinted in his club's colors. The name seeds small
 * variations (clouds, light towers) so a team's cards don't look stamped from
 * one plate.
 */
function VintageFront({ card, role, colors }: { card: CardSnapshot; role: SilhouetteRole; colors: TeamColors }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const id = (part: string) => `vc${uid}-${part}`;
  let seed = 0;
  for (let i = 0; i < card.name.length; i++) seed = (seed * 31 + card.name.charCodeAt(i)) % 9973;
  const rand = (n: number) => {
    const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };

  const ink = colors.ink;
  const paper = PAPER;
  const paperDeep = mix(PAPER, colors.primary, 0.08);
  const tailFill = mix(PAPER, colors.primary, 0.22);
  // A sepia ballpark, warmed or cooled a touch toward the club's color.
  const haze = mix(mix(SEPIA, ink, 0.45), colors.primary, 0.15);
  const skyTop = mix(mix(SEPIA, colors.primary, 0.16), ink, 0.08);
  const skyMid = mix(mix(PAPER, SEPIA, 0.45), colors.glow, 0.12);
  const ground = mix(mix(SEPIA, colors.primary, 0.12), ink, 0.18);

  const name = card.name.toUpperCase();
  const nameSize = fitSize(name, 132, 20, 8.5, 0.72);
  const positions = positionLine(card).toUpperCase();
  const posSize = fitSize(positions, 92, 10.5, 6, 0.74);
  const team = teamAbbr(card.teamLabel) || 'CBL';
  const teamSize = fitSize(team, 26, 8.6, 5, 0.75);

  // Scene window and the figure's place in it.
  const scene = { x: 30, y: 60, w: 190, h: 224 };
  const moundY = 278;
  const figScale = 2.0;
  const leftTower = { x: 52 + rand(1) * 10, top: 148 + rand(2) * 22 };
  const rightTower = { x: 186 + rand(3) * 12, top: 112 + rand(4) * 20 };
  const clouds = Array.from({ length: 7 }, (_, i) => ({
    cx: 30 + rand(10 + i) * 190,
    cy: 92 + rand(20 + i) * 90,
    rx: 22 + rand(30 + i) * 30,
    ry: 6 + rand(40 + i) * 8,
    o: 0.18 + rand(50 + i) * 0.22,
  }));

  return (
    <svg viewBox="0 0 250 350" className="block h-full w-full" role="img" aria-label={`${card.name}, ${ROLE_LABEL[role]}, ${team} ${card.cardYear}`}>
      <defs>
        <radialGradient id={id('age')} cx="50%" cy="45%" r="75%">
          <stop offset="60%" stopColor="#7a5a2c" stopOpacity="0" />
          <stop offset="100%" stopColor="#7a5a2c" stopOpacity="0.32" />
        </radialGradient>
        <pattern id={id('stripe')} width="2.6" height="10" patternUnits="userSpaceOnUse">
          <rect width="2.6" height="10" fill={paperDeep} />
          <rect width="0.85" height="10" fill={ink} opacity="0.42" />
        </pattern>
        <linearGradient id={id('sky')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={skyTop} />
          <stop offset="55%" stopColor={skyMid} />
          <stop offset="100%" stopColor={mix(PAPER, '#ffffff', 0.25)} />
        </linearGradient>
        <radialGradient id={id('sun')} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fffaf0" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#fffaf0" stopOpacity="0" />
        </radialGradient>
        <pattern id={id('fence')} width="4" height="4" patternUnits="userSpaceOnUse">
          <path d="M0 0 L4 4 M4 0 L0 4" stroke={ink} strokeWidth="0.35" opacity="0.5" />
        </pattern>
        <clipPath id={id('scene')}>
          <rect x={scene.x} y={scene.y} width={scene.w} height={scene.h} />
        </clipPath>
        <path id={id('nameArc')} d="M48 63 Q125 31 202 63" />
        <path id={id('posArc')} d="M62 301 Q125 309 188 301" />
      </defs>

      {/* card stock and frame */}
      <rect width="250" height="350" fill={paper} />
      <rect x="9" y="9" width="232" height="332" rx="5" fill={ink} />
      <rect x="13.5" y="13.5" width="223" height="323" rx="2.5" fill={paperDeep} />
      <rect x="18" y="18" width="214" height="314" fill={`url(#${id('stripe')})`} />
      <rect x="18" y="18" width="214" height="314" fill="none" stroke={ink} strokeWidth="0.9" />
      <rect x="23" y="23" width="204" height="304" fill="none" stroke={ink} strokeWidth="0.5" opacity="0.7" />

      {/* the ballpark */}
      <g clipPath={`url(#${id('scene')})`}>
        <rect x={scene.x} y={scene.y} width={scene.w} height={scene.h} fill={`url(#${id('sky')})`} />
        <ellipse cx="125" cy="170" rx="90" ry="70" fill={`url(#${id('sun')})`} />
        {clouds.map((c, i) => (
          <ellipse key={i} cx={c.cx} cy={c.cy} rx={c.rx} ry={c.ry} fill={i % 3 === 0 ? ink : '#fffaf0'} opacity={i % 3 === 0 ? c.o * 0.35 : c.o} />
        ))}

        {/* light towers */}
        {[leftTower, rightTower].map((t, i) => (
          <g key={i} fill={haze} opacity="0.9">
            <rect x={t.x - 0.9} y={t.top} width="1.8" height={252 - t.top} />
            <rect x={t.x - 11} y={t.top - 12} width="22" height="13" rx="1" />
            {Array.from({ length: 12 }, (_, k) => (
              <circle key={k} cx={t.x - 8.2 + (k % 4) * 5.5} cy={t.top - 9 + Math.floor(k / 4) * 3.6} r="1.3" fill="#fffaf0" opacity="0.85" />
            ))}
          </g>
        ))}

        {/* grandstand and its railing, off to the right */}
        <path d="M140 252 L220 226 L220 252 Z" fill={haze} opacity="0.85" />
        {[0, 1, 2, 3].map((k) => (
          <path key={k} d={`M${150 + k * 18} ${249 - k * 6} V${243 - k * 6}`} stroke={haze} strokeWidth="0.8" />
        ))}
        <path d="M146 245 L220 221" stroke={haze} strokeWidth="0.9" />
        <rect x="211" y="208" width="0.8" height="16" fill={haze} />
        <path d="M211.8 208 L218 210.5 L211.8 213 Z" fill={haze} />

        {/* outfield fence */}
        <rect x={scene.x} y="238" width={scene.w} height="14" fill={mix(haze, PAPER, 0.35)} opacity="0.8" />
        <rect x={scene.x} y="238" width={scene.w} height="14" fill={`url(#${id('fence')})`} />
        <rect x={scene.x} y="237" width={scene.w} height="1.2" fill={haze} />
        {Array.from({ length: 9 }, (_, k) => (
          <rect key={k} x={scene.x + 4 + k * 23} y="236" width="1.1" height="16" fill={haze} />
        ))}

        {/* the field */}
        <rect x={scene.x} y="252" width={scene.w} height="40" fill={ground} />
        <rect x={scene.x} y="252" width={scene.w} height="1" fill={ink} opacity="0.35" />
        <rect x={scene.x} y="259" width={scene.w} height="4" fill={mix(ground, PAPER, 0.25)} opacity="0.7" />
        <ellipse cx="125" cy={moundY} rx="80" ry="10" fill={ink} />

        {/* the player */}
        <g transform={`translate(${125 - 50 * figScale} ${moundY + 1 - 98 * figScale}) scale(${figScale})`}>
          <SilhouetteGroup pose={ROLE_POSE[role]} fill={ink} />
        </g>

        <rect x={scene.x} y={scene.y} width={scene.w} height={scene.h} fill={`url(#${id('age')})`} />
      </g>
      <rect x={scene.x} y={scene.y} width={scene.w} height={scene.h} fill="none" stroke={ink} strokeWidth="1.8" />
      <rect x={scene.x + 2.6} y={scene.y + 2.6} width={scene.w - 5.2} height={scene.h - 5.2} fill="none" stroke={paper} strokeWidth="0.7" opacity="0.8" />

      {/* corner ornaments */}
      <g transform="translate(13.5 13.5)">
        <CornerOrnament ink={ink} paper={paperDeep} />
      </g>
      <g transform="translate(236.5 13.5) scale(-1 1)">
        <CornerOrnament ink={ink} paper={paperDeep} />
      </g>
      <g transform="translate(13.5 336.5) scale(1 -1)">
        <CornerOrnament ink={ink} paper={paperDeep} />
      </g>
      <g transform="translate(236.5 336.5) scale(-1 -1)">
        <CornerOrnament ink={ink} paper={paperDeep} />
      </g>

      {/* the name ribbon: tails tucked behind, folds, then the arched face */}
      <g stroke={ink} strokeWidth="1.3" strokeLinejoin="round">
        <path d="M54 58 L22 66 L31 78 L22 92 L54 84 Z" fill={tailFill} />
        <path d="M196 58 L228 66 L219 78 L228 92 L196 84 Z" fill={tailFill} />
        <path d="M48 76 L54 84 L54 74 Z" fill={ink} />
        <path d="M202 76 L196 84 L196 74 Z" fill={ink} />
        <path d="M48 47 Q125 15 202 47 L202 76 Q125 44 48 76 Z" fill={paper} />
      </g>
      <path d="M52 50.5 Q125 19.5 198 50.5 M52 72.5 Q125 41.5 198 72.5" stroke={ink} strokeWidth="0.5" fill="none" opacity="0.7" />
      <text fontFamily={SLAB} fontWeight="900" fontSize={nameSize} fill={ink} letterSpacing="0.6" dominantBaseline="central">
        <textPath href={`#${id('nameArc')}`} startOffset="50%" textAnchor="middle">
          {name}
        </textPath>
      </text>

      {/* the position ribbon */}
      <g stroke={ink} strokeWidth="1.2" strokeLinejoin="round">
        <path d="M66 287 L28 283 L37 295 L28 307 L66 311 Z" fill={tailFill} />
        <path d="M184 287 L222 283 L213 295 L222 307 L184 311 Z" fill={tailFill} />
        <path d="M60 312 L66 311 L66 304 Z" fill={ink} />
        <path d="M190 312 L184 311 L184 304 Z" fill={ink} />
        <path d="M60 289 Q125 297 190 289 L190 312 Q125 320 60 312 Z" fill={paper} />
      </g>
      <polygon points={star(46, 295.5, 4.2)} fill={colors.primary} opacity="0.8" />
      <polygon points={star(204, 295.5, 4.2)} fill={colors.primary} opacity="0.8" />
      <polygon points={star(68, 301, 2.4)} fill={colors.primary} />
      <polygon points={star(182, 301, 2.4)} fill={colors.primary} />
      <text fontFamily={SLAB} fontWeight="800" fontSize={posSize} fill={ink} letterSpacing="0.5" dominantBaseline="central">
        <textPath href={`#${id('posArc')}`} startOffset="50%" textAnchor="middle">
          {positions}
        </textPath>
      </text>

      {/* team and year in the bottom corners */}
      <g fontFamily={SLAB} fontWeight="800" textAnchor="middle" dominantBaseline="central">
        <rect x="36" y="314" width="34" height="13" rx="2" fill={colors.primary} stroke={ink} strokeWidth="0.8" />
        <text x="53" y="320.8" fontSize={teamSize} fill={paper} letterSpacing="0.5">
          {team}
        </text>
        <rect x="180" y="314" width="34" height="13" rx="2" fill={paper} stroke={ink} strokeWidth="0.8" />
        <text x="197" y="320.8" fontSize="8" fill={ink} letterSpacing="0.4">
          {card.cardYear}
        </text>
      </g>

      <rect width="250" height="350" fill={`url(#${id('age')})`} pointerEvents="none" />
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
