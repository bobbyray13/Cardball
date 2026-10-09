import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSession } from '../session.js';
import { CardToaster } from './Toasts.js';

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-chalk text-field-deep' : 'text-chalk/70 hover:bg-white/10 hover:text-chalk'
  }`;

export function AppShell() {
  const { user, signOut } = useSession();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      <header className="z-30 sm:sticky sm:top-0 border-b border-white/10 bg-field-deep/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <NavLink to="/" className="flex items-baseline gap-2">
            <span className="font-display text-lg font-bold tracking-tight text-chalk">Baseball</span>
            <span className="font-display text-lg font-bold tracking-tight text-gold">Cardball</span>
          </NavLink>

          <nav className="flex flex-wrap items-center gap-1">
            <NavLink to="/" end className={link}>
              Lobby
            </NavLink>
            <NavLink to="/collection" className={link}>
              Collection
            </NavLink>
            <NavLink to="/challenges" className={link}>
              Challenges
            </NavLink>
            <NavLink to="/search" className={link}>
              Card search
            </NavLink>
            <NavLink to="/teams" className={link}>
              Teams
            </NavLink>
            <NavLink to="/drafts" className={link}>
              Drafts
            </NavLink>
            <NavLink to="/tournaments" className={link}>
              Tournaments
            </NavLink>
            {user?.isAdmin ? (
              <NavLink to="/admin" className={link}>
                Commissioner
              </NavLink>
            ) : null}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {user ? (
              <NavLink to={`/players/${encodeURIComponent(user.displayName)}`} className="text-sm text-chalk/60 hover:text-gold" aria-label="Your profile">
                {/* Phones show a compact initial instead of the whole name,
                    since the profile link used to be unreachable below sm. */}
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gold/40 text-xs font-semibold text-gold sm:hidden">
                  {user.displayName.charAt(0).toUpperCase()}
                </span>
                <span className="hidden sm:inline">{user.displayName}</span>
              </NavLink>
            ) : null}
            <button
              type="button"
              className="rounded-full border border-white/20 px-3 py-1.5 text-sm text-chalk/80 hover:bg-white/10"
              onClick={() => {
                void signOut().then(() => navigate('/login'));
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>

      <footer className="mx-auto max-w-6xl px-4 pt-4 pb-10 text-xs text-chalk/40">
        Play the tabletop dice game with your real baseball cards. Stats from the Baseball Databank.
      </footer>

      <CardToaster />
    </div>
  );
}
