import type { CardSnapshot } from '@cardball/shared';
import { hitMod, pitMod, sbMod } from '@cardball/shared';
import { formatIp } from '@cardball/engine';

/**
 * The Ball Card, drawn from real stats.
 *
 * The front is a card face: a team-color header, the player's own photo when he
 * has one, and otherwise original procedural art (a ballpark built from the
 * team's colors). The back carries the six-season stat window that the rules
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
  face?: CardFace;
  className?: string;
}

/** Deterministic team colors, so the same franchise always looks the same. */
export function teamColors(label: string): { primary: string; secondary: string; accent: string } {
  let hash = 0;
  const key = label || 'Cardball';
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 360;
  const hue = hash;
  return {
    primary: `hsl(${hue} 52% 30%)`,
    secondary: `hsl(${(hue + 28) % 360} 46% 22%)`,
    accent: `hsl(${(hue + 190) % 360} 60% 62%)`,
  };
}

const fmtAvg = (avg: number | null) => (avg === null ? '—' : avg.toFixed(3).replace(/^0/, ''));
const fmtMod = (mod: number) => (mod > 0 ? `+${mod}` : String(mod));

export function BallCard({ card, photoId, rarity, face = 'front', className = '' }: BallCardProps) {
  const colors = teamColors(card.teamLabel);
  const shell =
    '@container relative aspect-[5/7] w-full overflow-hidden rounded-[var(--radius-card)] card-stock text-ink shadow-[0_18px_40px_-18px_rgba(0,0,0,0.8)] ring-1 ring-black/25 select-none';

  return (
    <div className={`${shell} ${className}`} style={{ containerType: 'inline-size' }}>
      {face === 'front' ? (
        <CardFront card={card} photoId={photoId} rarity={rarity} colors={colors} />
      ) : (
        <CardBack card={card} colors={colors} />
      )}
    </div>
  );
}

function CardFront({
  card,
  photoId,
  rarity,
  colors,
}: {
  card: CardSnapshot;
  photoId?: number | null;
  rarity?: string | null;
  colors: { primary: string; secondary: string; accent: string };
}) {
  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-baseline justify-between px-[4cqw] pt-[3cqw] pb-[2.2cqw] text-chalk"
        style={{ background: `linear-gradient(100deg, ${colors.primary}, ${colors.secondary})` }}
      >
        <span className="truncate text-[3.6cqw] font-semibold tracking-[0.18em] uppercase">{card.teamLabel || 'Cardball'}</span>
        <span className="shrink-0 pl-[2cqw] font-mono text-[3.6cqw] tabular-nums opacity-90">{card.cardYear}</span>
      </header>

      <div className="relative min-h-0 flex-1">
        {photoId ? (
          <img src={`/api/photos/${photoId}`} alt={`${card.name} card`} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <ProceduralArt name={card.name} colors={colors} />
        )}
        {rarity ? (
          <span
            className="absolute top-[2cqw] right-[2cqw] rounded-full px-[2.4cqw] py-[0.8cqw] text-[2.6cqw] font-bold tracking-wider text-ink uppercase"
            style={{ background: 'var(--color-gold)' }}
          >
            {rarity}
          </span>
        ) : null}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[30%] bg-gradient-to-t from-black/45 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-[1.2cqw] px-[3.4cqw] pb-[2.4cqw]">
          {(card.positions.length ? card.positions : ['DH']).slice(0, 5).map((pos) => (
            <span
              key={pos}
              className="rounded-[0.4cqw] border border-chalk/50 bg-black/35 px-[1.6cqw] py-[0.4cqw] font-mono text-[2.8cqw] font-bold text-chalk"
            >
              {pos}
            </span>
          ))}
        </div>
      </div>

      <footer className="border-t border-ink/10 bg-stock-dark/40 px-[4cqw] py-[2.6cqw]">
        <div className="truncate font-display text-[6.4cqw] leading-none font-semibold">{card.name}</div>
        <div className="mt-[1.4cqw] flex items-center justify-between font-mono text-[2.9cqw] text-ink-soft">
          <span>
            B/T {card.bats ?? '?'}/{card.throws ?? '?'}
          </span>
          <span>
            {card.pitcherClass ? `${card.pitcherClass} · ` : ''}
            {card.canBat ? 'hits' : 'no bat'}
          </span>
        </div>
      </footer>
    </div>
  );
}

/** Original art: a ballpark drawn from the team's colors, seeded by the name. */
function ProceduralArt({ name, colors }: { name: string; colors: { primary: string; secondary: string; accent: string } }) {
  let seed = 0;
  for (let i = 0; i < name.length; i++) seed = (seed * 17 + name.charCodeAt(i)) % 997;
  const standHeight = 30 + (seed % 14);
  const wallDepth = 62 + (seed % 9);
  const initial = (name.trim()[0] ?? '?').toUpperCase();

  return (
    <svg viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice" className="h-full w-full" role="img" aria-label={`${name} artwork`}>
      <defs>
        <linearGradient id={`sky-${seed}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colors.accent} stopOpacity="0.55" />
          <stop offset="100%" stopColor={colors.primary} stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id={`grass-${seed}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2f7d55" />
          <stop offset="100%" stopColor="#1b5638" />
        </linearGradient>
      </defs>

      <rect width="100" height="140" fill={`url(#sky-${seed})`} />
      {/* stands */}
      <path d={`M0 ${standHeight} L100 ${standHeight - 6} L100 46 L0 52 Z`} fill={colors.secondary} opacity="0.9" />
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={i} x={2 + i * 11} y={standHeight + 4} width="6" height="4" fill="#ffffff" opacity="0.16" rx="1" />
      ))}
      {/* outfield wall + grass */}
      <path d={`M-4 52 C 30 ${wallDepth - 12} 70 ${wallDepth - 12} 104 52 L104 140 L-4 140 Z`} fill={`url(#grass-${seed})`} />
      <path d={`M-4 52 C 30 ${wallDepth - 12} 70 ${wallDepth - 12} 104 52`} fill="none" stroke="#f6f2e6" strokeOpacity="0.5" strokeWidth="1.6" />
      {/* infield diamond, seen from behind the plate */}
      <path d="M50 126 L86 98 L50 70 L14 98 Z" fill="#c08c56" />
      <path d="M50 118 L78 98 L50 78 L22 98 Z" fill="#2f7d55" />
      <circle cx="50" cy="98" r="7" fill="#c08c56" />
      <path d="M50 126 L86 98" stroke="#f6f2e6" strokeWidth="1.2" />
      <path d="M50 126 L14 98" stroke="#f6f2e6" strokeWidth="1.2" />
      <circle cx="50" cy="124" r="2.6" fill="#f6f2e6" />
      {/* bases */}
      {[
        [50, 118],
        [78, 98],
        [50, 78],
        [22, 98],
      ].map(([x, y], i) => (
        <rect key={i} x={x! - 3} y={y! - 3} width="6" height="6" fill="#f6f2e6" rx="0.8" transform={`rotate(45 ${x} ${y})`} />
      ))}
      {/* monogram */}
      <text
        x="50"
        y={standHeight - 8}
        textAnchor="middle"
        fontFamily="ui-serif, Georgia, serif"
        fontSize="30"
        fontWeight="700"
        fill="#f6f2e6"
        opacity="0.82"
      >
        {initial}
      </text>
      <circle cx="88" cy="34" r="7" fill="#f6f2e6" />
      <path d="M81 30 q7 4 14 0 M81 38 q7 -4 14 0" stroke="#b3241f" strokeWidth="1" fill="none" />
    </svg>
  );
}

function CardBack({ card, colors }: { card: CardSnapshot; colors: { primary: string; secondary: string } }) {
  const rows = card.seasons;

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-baseline justify-between px-[4cqw] pt-[3cqw] pb-[2cqw] text-chalk"
        style={{ background: `linear-gradient(100deg, ${colors.primary}, ${colors.secondary})` }}
      >
        <span className="truncate font-display text-[4.4cqw] font-semibold">{card.name}</span>
        <span className="shrink-0 pl-[2cqw] font-mono text-[3.2cqw] opacity-90">{card.cardYear}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden px-[2.6cqw] py-[2.4cqw]">
        {rows.length === 0 ? (
          <p className="px-[1cqw] text-[3cqw] text-ink-soft">No seasons on this card back.</p>
        ) : (
          <table className="w-full border-collapse font-mono text-[2.55cqw] tabular-nums">
            <thead>
              <tr className="text-ink-soft">
                <th className="text-left font-sans font-semibold">YR</th>
                <th className="text-right font-sans font-semibold">AVG</th>
                <th className="text-right font-sans font-semibold">HIT</th>
                <th className="text-right font-sans font-semibold">HR</th>
                <th className="text-right font-sans font-semibold">RBI</th>
                <th className="text-right font-sans font-semibold">SB</th>
                <th className="text-right font-sans font-semibold">ERA</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.year} className="border-t border-ink/10">
                  <td className="py-[0.5cqw] text-left">{String(s.year).slice(2)}</td>
                  <td className="text-right">{fmtAvg(s.avg)}</td>
                  <td className="text-right font-bold" style={{ color: 'var(--color-crimson)' }}>
                    {s.ab >= 100 ? fmtMod(hitMod(s.avg)) : '·'}
                  </td>
                  <td className="text-right">{s.homeRuns}</td>
                  <td className="text-right">{s.rbi}</td>
                  <td className="text-right">
                    {s.sb}
                    <span className="pl-[0.8cqw] font-bold" style={{ color: 'var(--color-navy)' }}>
                      {fmtMod(sbMod(s.sb))}
                    </span>
                  </td>
                  <td className="text-right">
                    {s.pitching ? (
                      <>
                        {s.pitching.era === null ? '—' : s.pitching.era.toFixed(2)}
                        <span className="pl-[0.8cqw] font-bold" style={{ color: 'var(--color-navy)' }}>
                          {fmtMod(pitMod(s.pitching.era))}
                        </span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-[2cqw] grid grid-cols-2 gap-x-[2cqw] gap-y-[0.6cqw] font-mono text-[2.4cqw] text-ink-soft">
          {rows
            .filter((s) => s.pitching && s.pitching.ipOuts > 0)
            .slice(-1)
            .map((s) => (
              <span key={s.year}>
                {s.year} IP {formatIp(s.pitching!.ipOuts)}
              </span>
            ))}
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

      <footer className="border-t border-ink/10 px-[4cqw] py-[2cqw] font-mono text-[2.4cqw] text-ink-soft">
        HIT from AVG · PIT from ERA · SB from steals
      </footer>
    </div>
  );
}
