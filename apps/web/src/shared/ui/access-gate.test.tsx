import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionAdapter } from '../auth/session-adapter';
import { SessionProvider } from '../auth/session-provider';
import { ANONYMOUS_SESSION, type Permission, type Session } from '../auth/session.types';
import { AccessGate } from './access-gate';

/**
 * Built locally rather than pulled from `test/test-utils` so the suite stays
 * off the plugin-registry import graph, and — more importantly — so the
 * deferred adapter below can exist. `SessionProvider` flips `isReady` only once
 * `getSession()` settles, so holding that promise open is the only way to
 * observe the hydrating window.
 */
function createSessionAdapter(session: Session): SessionAdapter {
  return {
    async getSession(): Promise<Session> {
      return session;
    },
    async getAccessToken(): Promise<string | null> {
      return session.accessToken;
    },
    async persistSession(): Promise<void> {},
    async clearSession(): Promise<void> {},
  };
}

/**
 * Adapter whose `getSession()` stays pending until `resolve()` is called, so a
 * test can assert the pre-hydration render and then prove the same tree does
 * render once the session lands. Without the second half, "renders nothing
 * while hydrating" would also pass for a component that renders nothing ever.
 */
function createDeferredSessionAdapter(session: Session): {
  adapter: SessionAdapter;
  resolve: () => void;
} {
  let release!: (value: Session) => void;
  const pending = new Promise<Session>((r) => {
    release = r;
  });
  return {
    adapter: {
      getSession: () => pending,
      async getAccessToken(): Promise<string | null> {
        return session.accessToken;
      },
      async persistSession(): Promise<void> {},
      async clearSession(): Promise<void> {},
    },
    resolve: () => release(session),
  };
}

/**
 * `role` is set to whatever the permission set actually implies, even though
 * the gate never reads it — a fixture whose role and permissions disagree
 * would quietly misrepresent what is under test.
 */
function authenticatedWith(permissions: Permission[]): Session {
  const isAdminSet = permissions.includes('connections:write');
  return {
    status: 'authenticated',
    accessToken: 'test-jwt-token',
    user: {
      id: isAdminSet ? 'user_admin' : 'user_viewer',
      username: isAdminSet ? 'admin' : 'viewer',
      email: null,
      role: isAdminSet ? 'admin' : 'viewer',
      permissions,
    },
  };
}

function renderGate(session: Session, gate: ReactNode): ReturnType<typeof render> {
  return render(
    <SessionProvider adapter={createSessionAdapter(session)}>{gate}</SessionProvider>,
  );
}

function gate(fallback?: ReactElement): ReactElement {
  return (
    <AccessGate require="connections:write" fallback={fallback}>
      <p>gated content</p>
    </AccessGate>
  );
}

const FALLBACK = <p>no access</p>;

describe('AccessGate', () => {
  afterEach(cleanup);

  it('should render children when the session holds the required permission', async () => {
    renderGate(authenticatedWith(['connections:read', 'connections:write']), gate());

    expect(await screen.findByText('gated content')).toBeInTheDocument();
  });

  it('should render the fallback when the session is ready and lacks the permission', async () => {
    renderGate(authenticatedWith(['connections:read']), gate(FALLBACK));

    expect(await screen.findByText('no access')).toBeInTheDocument();
    expect(screen.queryByText('gated content')).not.toBeInTheDocument();
  });

  it('should render nothing when the permission is absent and no fallback is given', async () => {
    const { container } = renderGate(authenticatedWith(['connections:read']), gate());

    // Wait for hydration to settle, so this asserts the denied branch rather
    // than the (also-empty) not-ready branch.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText('gated content')).not.toBeInTheDocument();
  });

  it('should render the fallback for an anonymous session', async () => {
    renderGate(ANONYMOUS_SESSION, gate(FALLBACK));

    expect(await screen.findByText('no access')).toBeInTheDocument();
    expect(screen.queryByText('gated content')).not.toBeInTheDocument();
  });

  it('should render neither branch while the session is still hydrating, then the children once it lands', async () => {
    const { adapter, resolve } = createDeferredSessionAdapter(
      authenticatedWith(['connections:read', 'connections:write']),
    );
    render(<SessionProvider adapter={adapter}>{gate(FALLBACK)}</SessionProvider>);

    // "Not known yet" is not "denied". Flashing the fallback and only then
    // revealing the children is the regression this guards.
    expect(screen.queryByText('no access')).not.toBeInTheDocument();
    expect(screen.queryByText('gated content')).not.toBeInTheDocument();

    // Releasing the session proves the emptiness above was the hydration
    // guard, not a component that never renders anything.
    resolve();
    expect(await screen.findByText('gated content')).toBeInTheDocument();
    expect(screen.queryByText('no access')).not.toBeInTheDocument();
  });
});
