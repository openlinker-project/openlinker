import type { Session } from './session.types';

export interface SessionAdapter {
  getSession(): Promise<Session>;
  getAccessToken(): Promise<string | null>;
  persistSession(token: string): Promise<void>;
  clearSession(): Promise<void>;
}
