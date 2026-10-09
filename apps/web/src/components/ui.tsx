import { useCallback, useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ApiError } from '../api.js';

/** A framed section with an optional title and header actions. */
export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel p-4 sm:p-5 ${className}`}>
      {title || actions ? (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title ? <h2 className="font-display text-xl font-semibold text-chalk">{title}</h2> : null}
            {subtitle ? <p className="mt-1 text-sm text-chalk/60">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

export function Button({ variant = 'secondary', size = 'md', className = '', ...rest }: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45';
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm' } as const;
  const variants = {
    primary: 'bg-gold text-ink hover:bg-gold/85 font-semibold',
    secondary: 'border border-white/20 text-chalk hover:bg-white/10',
    ghost: 'text-chalk/70 hover:bg-white/10 hover:text-chalk',
    danger: 'border border-crimson/60 text-crimson hover:bg-crimson/15',
  } as const;
  return <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold tracking-wide text-chalk/60 uppercase">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-chalk/45">{hint}</span> : null}
    </label>
  );
}

/**
 * A form control on the dark dugout chrome. The surface is a solid, slightly
 * lifted dark rather than a translucent black, so a select's closed control
 * reads clearly against a panel, and it lightens under focus — the state a
 * dropdown sits in while its list is open. The option list itself is painted
 * by the OS and is styled in index.css.
 */
export const inputClass =
  'w-full rounded-lg border border-white/25 bg-dugout-light px-3 py-2 text-sm text-chalk placeholder:text-chalk/40 focus:border-gold focus:bg-dugout focus:outline-none';

/** Shows an error from the API in the server's own words. */
export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);
  return (
    <p role="alert" className="rounded-lg border border-crimson/50 bg-crimson/10 px-3 py-2 text-sm text-crimson">
      {message}
    </p>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold">{children}</p>;
}

/** A small pill button, for a filter or a toggle that is one of a few. */
export function Chip({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-35 ${
        active ? 'bg-chalk text-field-deep' : 'border border-white/15 text-chalk/70 hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <p className="animate-pulse py-6 text-center text-sm text-chalk/50">{label}</p>;
}

/**
 * While `active`, keeps Tab focus inside the element the returned ref lands
 * on, focuses it on open, and restores focus to what had it on close. Modals
 * mount the trap so a keyboard user never ends up tabbing behind the overlay.
 */
export function useFocusTrap(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () =>
      [...container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => {
        const formControl =
          el instanceof HTMLButtonElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
        return !(formControl && el.disabled) && el.offsetParent !== null;
      });
    (focusable()[0] ?? container).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [active]);
  return ref;
}

/**
 * A styled stand-in for window.confirm: a modal overlay in the house style
 * with an Escape-cancel, a focus trap, and a busy flag for the action it
 * gates. `children` can hold anything a decision needs beyond a plain prompt.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  /** Omit for decisions whose children hold the buttons themselves. */
  onConfirm?: (() => void) | undefined;
  onCancel: () => void;
}) {
  const trap = useFocusTrap(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onCancel}>
      <div ref={trap} tabIndex={-1} className="panel w-full max-w-sm p-5 outline-none" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-semibold text-chalk">{title}</h2>
        {children ? <div className="mt-2 space-y-2 text-sm text-chalk/70">{children}</div> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          {onConfirm ? (
            <Button variant={danger ? 'danger' : 'primary'} disabled={busy} onClick={onConfirm}>
              {busy ? 'Working…' : confirmLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-white/15 px-4 py-8 text-center">
      <p className="font-display text-lg text-chalk/80">{title}</p>
      {children ? <div className="mt-2 text-sm text-chalk/55">{children}</div> : null}
    </div>
  );
}

/** Load data once (and on demand), with loading and error state. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, reload, setData };
}

/** Runs an action, tracking a busy flag and surfacing the error. */
export function useAction<A extends unknown[], R>(run: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const execute = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setBusy(true);
      setError(null);
      try {
        return await run(...args);
      } catch (err) {
        setError(err);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [run],
  );

  return { execute, busy, error, setError };
}
