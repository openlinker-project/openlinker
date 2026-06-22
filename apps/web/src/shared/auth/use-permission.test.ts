import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { usePermission } from './use-permission';
import { SessionProvider } from './session-provider';
import type { SessionAdapter } from './session-adapter';
import type { Session } from './session.types';
import { ANONYMOUS_SESSION } from './session.types';

function makeAdapter(session: Session): SessionAdapter {
  return {
    getSession: async () => session,
    getAccessToken: async () => session.accessToken ?? '',
    persistSession: async () => {},
    clearSession: async () => {},
  };
}

function makeWrapper(session: Session) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(SessionProvider, { adapter: makeAdapter(session) }, children);
  };
}

const adminSession: Session = {
  status: 'authenticated',
  accessToken: 'tok',
  user: {
    id: 'u1',
    username: 'admin',
    email: null,
    role: 'admin',
    permissions: [
      'connections:read',
      'connections:write',
      'sync:read',
      'sync:write',
      'orders:read',
      'orders:write',
      'products:read',
      'products:write',
      'inventory:read',
      'inventory:write',
      'listings:read',
      'listings:write',
    ],
  },
};

const viewerSession: Session = {
  status: 'authenticated',
  accessToken: 'tok',
  user: {
    id: 'u2',
    username: 'viewer',
    email: null,
    role: 'viewer',
    permissions: [
      'connections:read',
      'sync:read',
      'orders:read',
      'products:read',
      'inventory:read',
      'listings:read',
    ],
  },
};

describe('usePermission', () => {
  it('should return true for admin holding the permission', async () => {
    const { result } = renderHook(() => usePermission('connections:write'), {
      wrapper: makeWrapper(adminSession),
    });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('should return true for viewer read permissions', async () => {
    const { result } = renderHook(() => usePermission('orders:read'), {
      wrapper: makeWrapper(viewerSession),
    });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('should return false for viewer on write permissions', async () => {
    const { result } = renderHook(() => usePermission('connections:write'), {
      wrapper: makeWrapper(viewerSession),
    });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('should return false for anonymous session', async () => {
    const { result } = renderHook(() => usePermission('connections:read'), {
      wrapper: makeWrapper(ANONYMOUS_SESSION),
    });
    // Anonymous session never hydrates to authenticated — stays false.
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('should return false for unknown permission even for admin', async () => {
    const { result } = renderHook(() => usePermission('nonexistent:permission'), {
      wrapper: makeWrapper(adminSession),
    });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
