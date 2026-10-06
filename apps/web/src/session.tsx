import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { SessionUser } from '@cardball/shared';
import { api } from './api.js';

interface SessionValue {
  user: SessionUser | null;
  /** true until the first /api/auth/me answer arrives */
  loading: boolean;
  /** true when the server has no accounts yet, so the first visitor registers freely */
  needsSetup: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; password: string; displayName: string; inviteCode?: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [status, me] = await Promise.all([api.authStatus(), api.me()]);
    setNeedsSetup(status.needsSetup);
    setUser(me.user);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      loading,
      needsSetup,
      refresh,
      signIn: async (email, password) => {
        const { user: signedIn } = await api.login({ email, password });
        setUser(signedIn);
      },
      register: async (input) => {
        const { user: created } = await api.register(input);
        setUser(created);
        setNeedsSetup(false);
      },
      signOut: async () => {
        await api.logout();
        setUser(null);
      },
    }),
    [user, loading, needsSetup, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}
