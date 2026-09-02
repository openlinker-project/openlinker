import { describe, it, expect } from 'vitest';
import { isAdminSession } from './is-admin-session';
import { ANONYMOUS_SESSION, type Session, type SessionUser } from './session.types';

function user(role: string): SessionUser {
  return { id: 'u1', username: 'u', email: null, role, permissions: [] };
}

function session(role: string, status: Session['status'] = 'authenticated'): Session {
  return { status, accessToken: 't', user: user(role) };
}

describe('isAdminSession', () => {
  it('should be true for an authenticated admin session', () => {
    expect(isAdminSession(session('admin'))).toBe(true);
  });

  it('should be false for an authenticated non-admin session', () => {
    expect(isAdminSession(session('operator'))).toBe(false);
  });

  it('should be false for an anonymous session even when a user object is present', () => {
    expect(isAdminSession(session('admin', 'anonymous'))).toBe(false);
    expect(isAdminSession(ANONYMOUS_SESSION)).toBe(false);
  });
});
