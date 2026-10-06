import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

/**
 * Keeps one broken panel from taking down the whole page.
 *
 * The game room renders a lot of state at once; if a single view throws, the
 * rest of the screen (and the play-by-play, which is the actual record of the
 * game) should stay usable.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Panel crashed:', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="rounded-xl border border-crimson/50 bg-crimson/10 p-4">
        <p className="font-display font-semibold text-crimson">{this.props.label ?? 'This panel'} hit a problem.</p>
        <p className="mt-1 font-mono text-xs text-crimson/80">{this.state.error.message}</p>
        <button
          type="button"
          className="mt-3 rounded-full border border-crimson/60 px-3 py-1.5 text-sm text-crimson hover:bg-crimson/15"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    );
  }
}
