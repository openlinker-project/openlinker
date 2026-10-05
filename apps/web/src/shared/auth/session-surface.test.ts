import { describe, expect, it } from 'vitest';

import { resolveSessionSurface } from './session-surface';
import { ANONYMOUS_SESSION, type Permission, type Session } from './session.types';

function signedIn(permissions: Permission[]): Session {
  return {
    status: 'authenticated',
    accessToken: 'token',
    user: { id: 'u1', username: 'someone', email: null, role: 'any', permissions },
  };
}

describe('resolveSessionSurface', () => {
  it('should be unknown when the session has not hydrated yet', () => {
    expect(resolveSessionSurface(false, signedIn(['bench:write']))).toBe('unknown');
  });

  it('should be anonymous when nobody is signed in', () => {
    expect(resolveSessionSurface(true, ANONYMOUS_SESSION)).toBe('anonymous');
  });

  it('should be bench-only when the session may work the bench and read nothing else', () => {
    expect(resolveSessionSurface(true, signedIn(['bench:write']))).toBe('bench-only');
  });

  it('should be app when the session may also read orders', () => {
    expect(
      resolveSessionSurface(true, signedIn(['orders:read', 'orders:write', 'bench:write']))
    ).toBe('app');
  });

  it('should be app for a read-only session without the bench', () => {
    expect(resolveSessionSurface(true, signedIn(['orders:read']))).toBe('app');
  });

  it('should be app when the session holds no permission at all', () => {
    expect(resolveSessionSurface(true, signedIn([]))).toBe('app');
  });
});
