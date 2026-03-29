import type { SessionAdapter } from './session-adapter';
import { ANONYMOUS_SESSION } from './session.types';

export function createNoopSessionAdapter(): SessionAdapter {
  return {
    async getSession(): Promise<typeof ANONYMOUS_SESSION> {
      return ANONYMOUS_SESSION;
    },
    async getAccessToken(): Promise<string | null> {
      return null;
    },
    async persistSession(): Promise<void> {
      return;
    },
    async clearSession(): Promise<void> {
      return;
    },
  };
}
