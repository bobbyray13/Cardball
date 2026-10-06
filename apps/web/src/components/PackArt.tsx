/**
 * The wax wrapper.
 *
 * A sealed pack is drawn rather than photographed: two theme colors, a foil
 * sheen, a printed label, and a crimped seam at each end. The same component
 * is used at every size — a thumbnail in the round header, a big wrapper on
 * the table — so the pack a manager tears open looks like the one they saw in
 * the room list.
 */
import { motion } from 'framer-motion';
import type { PackTheme } from '@cardball/shared';

/** The zig-zag crimp along a pack's top and bottom edges. */
const crimp = (color: string) =>
  `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 8px)`;

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
  const dims = {
    xs: 'h-7 w-5 rounded-sm p-0.5',
    sm: 'h-24 w-[68px] rounded-md p-1.5',
    md: 'h-44 w-[124px] rounded-lg p-2.5',
    lg: 'h-60 w-[168px] rounded-xl p-3.5',
  }[size];
  const title = { xs: 'hidden', sm: 'text-[9px]', md: 'text-xs', lg: 'text-sm' }[size];
  const hold = { xs: 'hidden', sm: 'text-[7px]', md: 'text-[9px]', lg: 'text-[10px]' }[size];

  return (
    <div
      className={`relative overflow-hidden shadow-[0_10px_30px_-12px_rgba(0,0,0,0.9)] ${dims} ${className}`}
      style={{ background: `linear-gradient(150deg, ${theme.colors.from}, ${theme.colors.to} 70%)`, color: theme.colors.ink }}
      role="img"
      aria-label={`${theme.name} pack${sealed ? ', sealed' : ', opened'}`}
    >
      {/* foil sheen */}
      <div
        className="pointer-events-none absolute inset-0 opacity-45 mix-blend-overlay"
        style={{ background: 'linear-gradient(105deg, transparent 25%, rgba(255,255,255,0.85) 48%, transparent 62%)' }}
      />
      {/* crimped seams */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1.5 opacity-70" style={{ background: crimp('rgba(0,0,0,0.45)') }} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5 opacity-70" style={{ background: crimp('rgba(0,0,0,0.45)') }} />

      <div className="relative flex h-full flex-col">
        {size === 'xs' ? null : (
          <>
            <p className={`font-display font-bold tracking-wide uppercase ${title}`}>{theme.name}</p>
            <p className={`mt-0.5 leading-tight opacity-80 ${hold}`}>{theme.hold}</p>
            <div className="mt-auto flex items-end justify-between">
              <span className={`font-mono uppercase opacity-70 ${hold}`}>Cardball</span>
              <span className={`font-mono opacity-70 ${hold}`}>{sealed ? 'sealed' : 'opened'}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A sealed pack that tears open. The wrapper peels up and out of the way while
 * the cards behind it fan into place.
 */
export function TearingPack({ theme, onOpen, busy, label }: { theme: PackTheme; onOpen: () => void; busy: boolean; label: string }) {
  return (
    <button type="button" onClick={onOpen} disabled={busy} className="group mx-auto block" aria-label={label}>
      <div className="relative">
        <motion.div
          className="mx-auto"
          whileHover={busy ? undefined : { y: -6, rotate: -1.5 }}
          whileTap={busy ? undefined : { scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        >
          <PackArt theme={theme} size="lg" />
        </motion.div>
        <motion.div
          className="pointer-events-none absolute inset-x-0 top-0 origin-top"
          initial={false}
          animate={busy ? { y: -70, rotateX: 55, opacity: 0 } : { y: 0, rotateX: 0, opacity: 1 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
        >
          <div className="mx-auto h-6 w-[168px] rounded-t-xl border-b border-black/30" style={{ background: theme.colors.from }} />
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
