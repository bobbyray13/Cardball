import { lazy, Suspense } from 'react';
import type { ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { Spinner } from './components/ui.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { useSession } from './session.js';

/** Lazy-load a named page export (React.lazy wants a default export). */
function page<T extends { [k: string]: unknown }>(name: keyof T & string, load: () => Promise<T>) {
  return lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
}

// The lobby and login are the first thing anyone sees, so they ship in the
// entry bundle; every other screen is fetched on first visit.
const CollectionPage = page('CollectionPage', () => import('./pages/CollectionPage.js'));
const ChallengesPage = page('ChallengesPage', () => import('./pages/ChallengesPage.js'));
const SearchPage = page('SearchPage', () => import('./pages/SearchPage.js'));
const TeamsPage = page('TeamsPage', () => import('./pages/TeamsPage.js'));
const TeamPage = page('TeamPage', () => import('./pages/TeamPage.js'));
const GamePage = page('GamePage', () => import('./pages/GamePage.js'));
const DraftsPage = page('DraftsPage', () => import('./pages/DraftsPage.js'));
const DraftPage = page('DraftPage', () => import('./pages/DraftPage.js'));
const TournamentsPage = page('TournamentsPage', () => import('./pages/TournamentsPage.js'));
const TournamentPage = page('TournamentPage', () => import('./pages/TournamentPage.js'));
const ProfilePage = page('ProfilePage', () => import('./pages/ProfilePage.js'));
const AdminPage = page('AdminPage', () => import('./pages/AdminPage.js'));

export default function App() {
  const { user, loading } = useSession();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <p className="animate-pulse font-display text-xl text-chalk/70">Warming up…</p>
      </div>
    );
  }

  return (
    <Suspense fallback={<Spinner label="Finding your seat…" />}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route element={user ? <AppShell /> : <Navigate to="/login" replace />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/collection" element={<CollectionPage />} />
          <Route path="/challenges" element={<ChallengesPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:id" element={<TeamPage />} />
          <Route path="/games/:id" element={<GamePage />} />
          <Route path="/drafts" element={<DraftsPage />} />
          <Route path="/drafts/:id" element={<DraftPage />} />
          <Route path="/tournaments" element={<TournamentsPage />} />
          <Route path="/tournaments/:id" element={<TournamentPage />} />
          <Route path="/players/:username" element={<ProfilePage />} />
          <Route path="/admin" element={user?.isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
