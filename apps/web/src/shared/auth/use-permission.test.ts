import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { useIsAdmin, usePermission, useWriteAccess } from './use-permission';
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
      'integrations:read',
      'integrations:write',
      'adapters:read',
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
      'integrations:read',
      'adapters:read',
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

  it('should return false for an invalid permission string (compile-time guard)', async () => {
    // @ts-expect-error — intentional: verifies the runtime false-path for an
    // unrecognised permission string. The Permission type makes this a
    // compile-time error in production callers; the cast here documents the
    // runtime behaviour without weakening the hook's signature.
    const { result } = renderHook(() => usePermission('nonexistent:permission'), {
      wrapper: makeWrapper(adminSession),
    });
    await waitFor(() => expect(result.current).toBe(false));
  });
});

describe('useWriteAccess', () => {
  it('grants full write access when the session holds the permission, regardless of demo mode', async () => {
    const { result } = renderHook(() => useWriteAccess('connections:write', true), {
      wrapper: makeWrapper(adminSession),
    });
    await waitFor(() =>
      expect(result.current).toEqual({ canWrite: true, demoReadOnly: false, visible: true }),
    );
  });

  it('marks a viewer without the permission as demo-read-only when demo mode is on (#1615)', async () => {
    const { result } = renderHook(() => useWriteAccess('connections:write', true), {
      wrapper: makeWrapper(viewerSession),
    });
    await waitFor(() =>
      expect(result.current).toEqual({ canWrite: false, demoReadOnly: true, visible: true }),
    );
  });

  it('hides the affordance for a viewer without the permission outside demo mode (unchanged)', async () => {
    const { result } = renderHook(() => useWriteAccess('connections:write', false), {
      wrapper: makeWrapper(viewerSession),
    });
    await waitFor(() =>
      expect(result.current).toEqual({ canWrite: false, demoReadOnly: false, visible: false }),
    );
  });
});

/**
 * `useIsAdmin` (#2342) — the narrow case a `Permission` cannot express: a route
 * guarded by `@Roles('admin')` whose permission is ALSO granted to a lesser
 * role, so gating on the permission alone renders a control that answers 403.
 *
 * The operator case below is the whole reason the hook exists: it is the shape
 * the order-hold routes have, and the one an inline `role === 'admin'` compare
 * would silently get wrong if the literal were ever mistyped.
 */
describe('useIsAdmin', () => {
  it('should return true for an admin session', async () => {
    const { result } = renderHook(() => useIsAdmin(), { wrapper: makeWrapper(adminSession) });

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it('should return false for a non-admin holding the write permission', async () => {
    const operatorSession: Session = {
      status: 'authenticated',
      accessToken: 'tok',
      user: {
        id: 'u3',
        username: 'operator',
        email: null,
        role: 'operator',
        permissions: ['orders:read', 'orders:write'],
      },
    };

    const { result } = renderHook(() => useIsAdmin(), { wrapper: makeWrapper(operatorSession) });

    // Holds `orders:write` and is still refused by an admin-only route — which
    // is exactly why the permission cannot stand in for the role here.
    const permission = renderHook(() => usePermission('orders:write'), {
      wrapper: makeWrapper(operatorSession),
    });

    await waitFor(() => {
      expect(permission.result.current).toBe(true);
      expect(result.current).toBe(false);
    });
  });

  it('should return false for a viewer', async () => {
    const { result } = renderHook(() => useIsAdmin(), { wrapper: makeWrapper(viewerSession) });

    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });

  it('should return false for an anonymous session', async () => {
    const { result } = renderHook(() => useIsAdmin(), {
      wrapper: makeWrapper(ANONYMOUS_SESSION),
    });

    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });
});
