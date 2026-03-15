import { useContext } from 'react';
import { SessionContext, type SessionContextValue } from './session-provider';

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);

  if (context === null) {
    throw new Error('useSession must be used within a SessionProvider');
  }

  return context;
}
