import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { AdminPage } from './pages/AdminPage.js';
import { CollectionPage } from './pages/CollectionPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { DraftPage } from './pages/DraftPage.js';
import { DraftsPage } from './pages/DraftsPage.js';
import { GamePage } from './pages/GamePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { SearchPage } from './pages/SearchPage.js';
import { TeamPage } from './pages/TeamPage.js';
import { TeamsPage } from './pages/TeamsPage.js';
import { useSession } from './session.js';

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
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={user ? <AppShell /> : <Navigate to="/login" replace />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/collection" element={<CollectionPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/teams/:id" element={<TeamPage />} />
        <Route path="/games/:id" element={<GamePage />} />
        <Route path="/drafts" element={<DraftsPage />} />
        <Route path="/drafts/:id" element={<DraftPage />} />
        <Route path="/admin" element={user?.isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
