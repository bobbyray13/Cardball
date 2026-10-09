/**
 * The wax wrapper.
 *
 * Every pack is printed by the Cardball Gum & Card Co., a card maker that
 * never existed: an arched CARDBALL wordmark, crimped foil seams, a pillowy
 * wrapper, and a theme emblem with a ballplayer breaking out of it. Each theme
 * gets its own print job — pattern, emblem shape, pose, and the joke along the
 * bottom — so a shelf of packs reads at a glance. The same component draws a
 * thumbnail in a list and the big wrapper a manager tears open.
 */
import { useId } from 'react';
import { motion } from 'framer-motion';
import type { PackTheme, PackThemeId } from '@cardball/shared';
import { SilhouetteGroup } from './Silhouette.js';
import type { SilhouettePose } from './Silhouette.js';

type Pattern = 'stripes' | 'pinstripes' | 'burst' | 'speed' | 'argyle' | 'vintage' | 'deco';
type Emblem = 'circle' | 'burst' | 'diamond' | 'shield' | 'oval' | 'octagon';

interface PrintJob {
  pose: SilhouettePose;
  pattern: Pattern;
  emblem: Emblem;
  /** the small print under the wordmark */
  series: string;
  /** the line along the bottom of the wrapper */
  flair: string;
}

const PRINT: Record<PackThemeId, PrintJob> = {
  mixed: { pose: 'Stance', pattern: 'stripes', emblem: 'circle', series: 'Base Ball Cards', flair: 'No gum · just cards' },
  sluggers: { pose: 'Swing', pattern: 'burst', emblem: 'burst', series: 'Power Series', flair: 'Going, going…' },
  aces: { pose: 'SP', pattern: 'pinstripes', emblem: 'diamond', series: 'Mound Series', flair: 'K · K · K · K' },
  speedsters: { pose: 'OF', pattern: 'speed', emblem: 'circle', series: 'Speed Series', flair: 'Swipe one!' },
  contact: { pose: 'Stance', pattern: 'argyle', emblem: 'shield', series: 'Champions Series', flair: 'Hit ’em where they ain’t' },
  deadball: { pose: 'IF', pattern: 'vintage', emblem: 'oval', series: 'Tobacco Series', flair: 'Est. 1909' },
  liveball: { pose: 'Swing', pattern: 'deco', emblem: 'octagon', series: 'Lively Ball Series', flair: 'Over the fence' },
};

const CHALK = '#f6f2e6';
const INK = '#1d1b18';

/** A zig-zag crimp edge across the wrapper, `teeth` points wide. */
function crimpPath(y: number, depth: number, down: boolean, teeth = 20): string {
  const step = 100 / teeth;
  let d = `M0 ${y}`;
  for (let i = 0; i < teeth; i++) {
    d += ` L${i * step + step / 2} ${down ? y + depth : y - depth} L${(i + 1) * step} ${y}`;
  }
  return d;
}

/** The backdrop shape behind the emblem's ballplayer, centered on (50, 70). */
function emblemPath(shape: Emblem): string {
  const cx = 50;
  const cy = 70;
  switch (shape) {
    case 'circle':
      return `M${cx - 25} ${cy} a25 25 0 1 0 50 0 a25 25 0 1 0 -50 0 Z`;
    case 'oval':
      return `M${cx - 21} ${cy} a21 27 0 1 0 42 0 a21 27 0 1 0 -42 0 Z`;
    case 'diamond':
      return `M${cx} ${cy - 30} L${cx + 30} ${cy} L${cx} ${cy + 30} L${cx - 30} ${cy} Z`;
    case 'shield':
      return `M${cx - 24} ${cy - 25} H${cx + 24} V${cy + 6} L${cx} ${cy + 28} L${cx - 24} ${cy + 6} Z`;
    case 'octagon': {
      const pts = Array.from({ length: 8 }, (_, i) => {
        const a = (Math.PI / 8) * (2 * i + 1);
        return `${(cx + Math.cos(a) * 27).toFixed(2)} ${(cy + Math.sin(a) * 27).toFixed(2)}`;
      });
      return `M${pts.join(' L')} Z`;
    }
    case 'burst': {
      const pts = Array.from({ length: 32 }, (_, i) => {
        const r = i % 2 === 0 ? 30 : 23;
        const a = (Math.PI / 16) * i;
        return `${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
      });
      return `M${pts.join(' L')} Z`;
    }
  }
}

/** The theme's print pattern, laid over the wrapper's base gradient. */
function PatternLayer({ pattern, id, ink }: { pattern: Pattern; id: string; ink: string }) {
  switch (pattern) {
    case 'stripes':
      return (
        <>
          <defs>
            <pattern id={id} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(-32)">
              <rect width="6" height="14" fill={CHALK} opacity="0.08" />
            </pattern>
          </defs>
          <rect width="100" height="142" fill={`url(#${id})`} />
        </>
      );
    case 'pinstripes':
      return (
        <>
          <defs>
            <pattern id={id} width="5" height="10" patternUnits="userSpaceOnUse">
              <rect width="0.6" height="10" fill={CHALK} opacity="0.16" />
            </pattern>
          </defs>
          <rect width="100" height="142" fill={`url(#${id})`} />
        </>
      );
    case 'burst':
      return (
        <g opacity="0.14">
          {Array.from({ length: 16 }, (_, i) => {
            const a0 = (i / 16) * Math.PI * 2;
            const a1 = a0 + Math.PI / 16;
            return <path key={i} d={`M50 70 L${50 + Math.cos(a0) * 120} ${70 + Math.sin(a0) * 120} L${50 + Math.cos(a1) * 120} ${70 + Math.sin(a1) * 120} Z`} fill={CHALK} />;
          })}
        </g>
      );
    case 'speed':
      return (
        <g stroke={CHALK} strokeLinecap="round" opacity="0.2">
          {[42, 50, 58, 66, 74, 82, 90].map((y, i) => (
            <path key={y} d={`M${4 + (i % 3) * 4} ${y} H${22 + (i % 2) * 6}`} strokeWidth={i % 2 ? 1.2 : 2} />
          ))}
          {[48, 62, 78].map((y) => (
            <path key={y} d={`M80 ${y} H96`} strokeWidth="1.2" />
          ))}
        </g>
      );
    case 'argyle':
      return (
        <>
          <defs>
            <pattern id={id} width="16" height="22" patternUnits="userSpaceOnUse">
              <path d="M8 0 L16 11 L8 22 L0 11 Z" fill={ink} opacity="0.07" />
              <path d="M0 0 L16 22 M16 0 L0 22" stroke={ink} strokeOpacity="0.12" strokeWidth="0.4" />
            </pattern>
          </defs>
          <rect width="100" height="142" fill={`url(#${id})`} />
        </>
      );
    case 'vintage':
      return (
        <>
          <defs>
            <pattern id={id} width="3" height="3" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="0.45" fill={CHALK} opacity="0.1" />
            </pattern>
          </defs>
          <rect width="100" height="142" fill={`url(#${id})`} />
          <rect x="6" y="11" width="88" height="120" rx="2" fill="none" stroke={CHALK} strokeOpacity="0.45" strokeWidth="0.8" />
          <rect x="8" y="13" width="84" height="116" rx="1.5" fill="none" stroke={CHALK} strokeOpacity="0.25" strokeWidth="0.4" />
        </>
      );
    case 'deco':
      return (
        <g fill="none" stroke="#e8c26a" strokeOpacity="0.32">
          {[16, 26, 36, 46, 56, 66].map((r) => (
            <path key={r} d={`M${50 - r} 142 A${r} ${r} 0 0 1 ${50 + r} 142`} strokeWidth="0.8" />
          ))}
          {Array.from({ length: 9 }, (_, i) => {
            const a = Math.PI + (Math.PI / 8) * i;
            return <path key={i} d={`M50 142 L${50 + Math.cos(a) * 80} ${142 + Math.sin(a) * 80}`} strokeWidth="0.5" />;
          })}
        </g>
      );
  }
}

export function PackArt({
  theme,
  size = 'md',
  sealed = true,
  className = '',
}: {
  theme: PackTheme;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  sealed?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const job = PRINT[theme.id] ?? PRINT.mixed;
  const dims = { xs: 'h-7 w-5', sm: 'h-24 w-[68px]', md: 'h-44 w-[124px]', lg: 'h-60 w-[169px]' }[size];
  const tiny = size === 'xs';
  const { from, to, ink } = theme.colors;
  // Light wrappers (Batting champs gold) print their ribbon dark; the rest cream.
  const ribbon = ink === CHALK ? CHALK : INK;
  const ribbonText = ink === CHALK ? to : '#f2d27a';
  const name = theme.name.toUpperCase();
  const vintage = job.pattern === 'vintage';
  const wordFont = vintage ? 'ui-serif, Georgia, serif' : "ui-serif, Georgia, 'Times New Roman', serif";

  return (
    <div
      className={`relative shrink-0 drop-shadow-[0_10px_14px_rgba(0,0,0,0.55)] ${dims} ${className}`}
      role="img"
      aria-label={`${theme.name} pack${sealed ? ', sealed' : ', opened'}`}
    >
      <svg viewBox="0 0 100 142" className="h-full w-full overflow-visible" aria-hidden="true">
        <defs>
          <linearGradient id={`${uid}-base`} x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
          {/* pillow shading: the wrapper bulges, so its sides fall into shadow */}
          <linearGradient id={`${uid}-pillow`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#000" stopOpacity="0.38" />
            <stop offset="12%" stopColor="#000" stopOpacity="0" />
            <stop offset="88%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.38" />
          </linearGradient>
          <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="30%" stopColor="#fff" stopOpacity="0" />
            <stop offset="47%" stopColor="#fff" stopOpacity="0.28" />
            <stop offset="53%" stopColor="#fff" stopOpacity="0.1" />
            <stop offset="66%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}-foil`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8d8d8d" />
            <stop offset="30%" stopColor="#e9e9e9" />
            <stop offset="55%" stopColor="#9c9c9c" />
            <stop offset="80%" stopColor="#f2f2f2" />
            <stop offset="100%" stopColor="#7a7a7a" />
          </linearGradient>
          <clipPath id={`${uid}-body`}>
            <rect x="1" y="5" width="98" height="132" rx="2.5" />
          </clipPath>
          <path id={`${uid}-arch`} d="M2 29 Q50 9 98 29" />
        </defs>

        {/* foil crimps, top and bottom; an opened pack has lost its top */}
        {sealed ? <path d={`${crimpPath(6, 4, false)} L100 9 L0 9 Z`} fill={`url(#${uid}-foil)`} /> : null}
        <path d={`${crimpPath(136, 4, true)} L100 133 L0 133 Z`} fill={`url(#${uid}-foil)`} />

        <g clipPath={`url(#${uid}-body)`}>
          <rect width="100" height="142" fill={`url(#${uid}-base)`} />
          <PatternLayer pattern={job.pattern} id={`${uid}-pat`} ink={ink} />

          {/* the emblem, with a ballplayer breaking out of it */}
          <path d={emblemPath(job.emblem)} fill={to} stroke={CHALK} strokeWidth="2" />
          <path d={emblemPath(job.emblem)} fill="none" stroke={INK} strokeOpacity="0.35" strokeWidth="0.6" transform="translate(50 70) scale(0.88) translate(-50 -70)" />
          {tiny ? null : (
            <g transform="translate(25 43) scale(0.52)">
              <SilhouetteGroup pose={job.pose} fill={INK} grow={2.4} />
              <SilhouetteGroup pose={job.pose} fill={CHALK} />
            </g>
          )}

          {tiny ? null : (
            <>
              {/* the brand: an arched wordmark over a red swoosh */}
              <path d="M9 31.5 Q50 18 91 31.5 L89 35.5 Q50 24 11 35.5 Z" fill="#b3241f" stroke={INK} strokeWidth="0.6" />
              <text
                fontFamily={wordFont}
                fontStyle={vintage ? 'normal' : 'italic'}
                fontWeight="900"
                fontSize="14"
                letterSpacing="0.3"
                fill={CHALK}
                stroke={INK}
                strokeWidth="2.6"
                strokeLinejoin="round"
                paintOrder="stroke"
              >
                <textPath href={`#${uid}-arch`} startOffset="50%" textAnchor="middle">
                  CARDBALL
                </textPath>
              </text>
              <text x="50" y="40.5" textAnchor="middle" fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="4.2" fontWeight="700" letterSpacing="1" fill={ink} opacity="0.9">
                {job.series.toUpperCase()}
              </text>

              {/* the theme ribbon, swallow-tailed */}
              <path d="M2 99 H14 L10 104.5 L14 110 H2 L5 104.5 Z" fill={ribbon} opacity="0.7" />
              <path d="M98 99 H86 L90 104.5 L86 110 H98 L95 104.5 Z" fill={ribbon} opacity="0.7" />
              <rect x="10" y="97" width="80" height="15" rx="1" fill={ribbon} stroke={INK} strokeWidth="0.6" />
              <text
                x="50"
                y="108"
                textAnchor="middle"
                fontFamily="ui-serif, Georgia, serif"
                fontWeight="900"
                fontSize="9.5"
                fill={ribbonText}
                {...(name.length > 9 ? { textLength: 72, lengthAdjust: 'spacingAndGlyphs' } : {})}
              >
                {name}
              </text>
              {/* Dark print would vanish into the wrapper's dark lower half, so it sits on a paper band. */}
              {ink !== CHALK ? <rect x="8" y="114.5" width="84" height="17.5" rx="1.5" fill={CHALK} opacity="0.82" /> : null}
              <text x="50" y="120" textAnchor="middle" fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="5" fontWeight="600" fill={ink}>
                {theme.hold}
              </text>
              <text x="50" y="129.5" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="3.8" letterSpacing="0.6" fill={ink} opacity="0.75">
                {sealed ? `★ ${job.flair.toUpperCase()} ★` : 'OPENED'}
              </text>
            </>
          )}

          <rect width="100" height="142" fill={`url(#${uid}-pillow)`} />
          <rect width="100" height="142" fill={`url(#${uid}-sheen)`} />
        </g>

        {/* an opened pack shows its torn edge */}
        {sealed ? null : <path d={`${crimpPath(5, 2.4, true, 13)} L100 3 L0 3 Z`} fill="#0d0d0d" opacity="0.55" />}
      </svg>
    </div>
  );
}

/**
 * A sealed pack that tears open. The foil strip peels up and away while the
 * cards behind it fan into place.
 */
export function TearingPack({ theme, onOpen, busy, label }: { theme: PackTheme; onOpen: () => void; busy: boolean; label: string }) {
  return (
    <button type="button" onClick={onOpen} disabled={busy} className="group mx-auto block" aria-label={label}>
      <div className="relative">
        <motion.div
          className="mx-auto w-fit"
          whileHover={busy ? undefined : { y: -6, rotate: -1.5 }}
          whileTap={busy ? undefined : { scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        >
          <PackArt theme={theme} size="lg" sealed={!busy} />
        </motion.div>
        <motion.div
          className="pointer-events-none absolute inset-x-0 top-0 origin-top"
          initial={false}
          animate={busy ? { y: [0, -70], rotateX: [0, 55], rotate: [0, -8], opacity: [1, 0] } : { y: 0, rotateX: 0, rotate: 0, opacity: 0 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
        >
          <div
            className="mx-auto h-4 w-[169px]"
            style={{
              background: 'linear-gradient(90deg,#8d8d8d,#e9e9e9,#9c9c9c,#f2f2f2,#7a7a7a)',
              clipPath: 'polygon(0 100%, 0 40%, 5% 0, 10% 40%, 15% 0, 20% 40%, 25% 0, 30% 40%, 35% 0, 40% 40%, 45% 0, 50% 40%, 55% 0, 60% 40%, 65% 0, 70% 40%, 75% 0, 80% 40%, 85% 0, 90% 40%, 95% 0, 100% 40%, 100% 100%)',
            }}
          />
        </motion.div>
      </div>
      <p className="mt-3 text-center text-sm font-medium text-gold group-hover:underline">{busy ? 'Tearing it open…' : label}</p>
      <p className="mt-1 max-w-[220px] text-center text-xs text-chalk/50">{theme.blurb}</p>
    </button>
  );
}

/** The cards sliding out of a freshly opened wrapper. */
export function RevealCards({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
