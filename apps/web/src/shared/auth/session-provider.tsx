import { createContext, useCallback, useEffect, useMemo, useState, type PropsWithChildren, type ReactElement } from 'react';
import type { SessionAdapter } from './session-adapter';
import { ANONYMOUS_SESSION, type Session } from './session.types';

export interface SessionContextValue {
  adapter: SessionAdapter;
  isReady: boolean;
  session: Session;
  clearSession: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

interface SessionProviderProps extends PropsWithChildren {
  adapter: SessionAdapter;
}

export function SessionProvider({ adapter, children }: SessionProviderProps): ReactElement {
  const [session, setSession] = useState<Session>(ANONYMOUS_SESSION);
  const [isReady, setIsReady] = useState(false);

  const refreshSession = useCallback(async (): Promise<void> => {
    const nextSession = await adapter.getSession();
    setSession(nextSession);
    setIsReady(true);
  }, [adapter]);

  const clearSession = useCallback(async (): Promise<void> => {
    await adapter.clearSession();
    setSession(ANONYMOUS_SESSION);
  }, [adapter]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const value = useMemo<SessionContextValue>(
    () => ({
      adapter,
      isReady,
      session,
      clearSession,
      refreshSession,
    }),
    [adapter, clearSession, isReady, refreshSession, session],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
