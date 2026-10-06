import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { defaultHouseRules, setActiveHouseRules } from '@cardball/shared';
import type { HouseRules, SessionUser } from '@cardball/shared';
import { api } from './api.js';

interface SessionValue {
  user: SessionUser | null;
  /** true until the first /api/auth/me answer arrives */
  loading: boolean;
  /** true when the server has no accounts yet, so the first visitor registers freely */
  needsSetup: boolean;
  /** the league's house rules, as the commissioner last saved them */
  rules: HouseRules;
  /** re-read the rules after the commissioner saves them */
  refreshRules: () => Promise<void>;
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
  const [rules, setRules] = useState<HouseRules>(() => defaultHouseRules());

  const refresh = useCallback(async () => {
    const [status, me] = await Promise.all([api.authStatus(), api.me()]);
    setNeedsSetup(status.needsSetup);
    setUser(me.user);
    if (me.user) await refreshRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshRules = useCallback(async () => {
    try {
      const { rules: saved } = await api.houseRules();
      setActiveHouseRules(saved);
      setRules(saved);
    } catch {
      // Signed out, or the request failed: the shipped defaults stay in force
      // and the card faces keep printing their standard bands.
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      loading,
      needsSetup,
      rules,
      refreshRules,
      refresh,
      signIn: async (email, password) => {
        const { user: signedIn } = await api.login({ email, password });
        setUser(signedIn);
        await refreshRules();
      },
      register: async (input) => {
        const { user: created } = await api.register(input);
        setUser(created);
        setNeedsSetup(false);
        await refreshRules();
      },
      signOut: async () => {
        await api.logout();
        setUser(null);
        setActiveHouseRules(defaultHouseRules());
        setRules(defaultHouseRules());
      },
    }),
    [user, loading, needsSetup, rules, refreshRules, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}
