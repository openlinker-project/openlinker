import type { SessionAdapter } from './session-adapter';
import { ANONYMOUS_SESSION } from './session.types';

export function createNoopSessionAdapter(): SessionAdapter {
  return {
    async getSession() {
      return ANONYMOUS_SESSION;
    },
    async getAccessToken() {
      return null;
    },
    async clearSession() {
      return;
    },
  };
}
