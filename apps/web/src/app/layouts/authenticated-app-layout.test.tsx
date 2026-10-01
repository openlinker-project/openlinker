import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthenticatedAppLayout } from './authenticated-app-layout';
import { ApiClientProvider } from '../api/api-client-provider';
import type { SessionAdapter } from '../../shared/auth/session-adapter';
import { SessionProvider } from '../../shared/auth/session-provider';
import { ThemeProvider } from '../../shared/theme/theme-provider';
import { LocaleProvider } from '../../shared/i18n';
import { ToastProvider } from '../../shared/ui/toast-provider';
import { createNoopSessionAdapter } from '../../shared/auth/noop-session-adapter';
import { createAuthenticatedSessionAdapter, createMockApiClient } from '../../test/test-utils';
import type { ApiClient } from '../api/api-client';
import type { SessionUser } from '../../shared/auth/session.types';
import { PermissionValues } from '../../shared/auth/session.types';
import type { RouteCrumbHandle } from '../nav-registry.types';

function TestChild(): React.ReactElement {
  return <div>Authenticated content</div>;
}

function LoginSentinel(): React.ReactElement {
  return <div>Login page</div>;
}

function SearchEchoLoginSentinel(): React.ReactElement {
  const location = useLocation();
  return <div>Login page search: {location.search}</div>;
}

function BenchSentinel(): React.ReactElement {
  return <div>Bench page</div>;
}

/** A packer: the bench, and nothing of the app (#3096, F-9). */
const PACKER: SessionUser = {
  id: 'user_9',
  username: 'packer',
  email: null,
  role: 'packer',
  permissions: ['bench:write'],
};

function ConsentSentinel(): React.ReactElement {
  const location = useLocation();
  return <div>Consent page next: {location.search}</div>;
}

function demoViewer(analyticsConsent: boolean): SessionUser {
  return {
    id: 'user_2',
    username: 'demo_visitor',
    email: 'demo@example.com',
    role: 'viewer',
    permissions: [...PermissionValues],
    analyticsConsent,
  };
}

function demoModeApiClient(demoMode: boolean): ApiClient {
  return createMockApiClient({
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode }) },
  } as Partial<ApiClient>);
}

const indexCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Dashboard' },
};

function renderLayout(
  sessionAdapter?: SessionAdapter,
  options?: {
    initialEntry?: string;
    loginElement?: React.ReactElement;
    apiClient?: ApiClient;
  }
): void {
  const adapter = sessionAdapter ?? createNoopSessionAdapter();
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AuthenticatedAppLayout />,
        children: [
          { index: true, handle: indexCrumb, element: <TestChild /> },
          { path: 'orders/:id', handle: indexCrumb, element: <TestChild /> },
          { path: 'fulfillment/works/:workId', handle: indexCrumb, element: <TestChild /> },
        ],
      },
      { path: '/bench', element: <BenchSentinel /> },
      { path: '/login', element: options?.loginElement ?? <LoginSentinel /> },
      { path: '/consent', element: <ConsentSentinel /> },
    ],
    { initialEntries: [options?.initialEntry ?? '/'] }
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <ThemeProvider>
      <LocaleProvider>
        <SessionProvider adapter={adapter}>
          <ToastProvider>
            <ApiClientProvider client={options?.apiClient ?? createMockApiClient()}>
              <QueryClientProvider client={queryClient}>
                <RouterProvider router={router} />
              </QueryClientProvider>
            </ApiClientProvider>
          </ToastProvider>
        </SessionProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}

describe('AuthenticatedAppLayout', () => {
  it('should redirect to /login when session is anonymous', async () => {
    renderLayout();

    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('should render children when session is authenticated', async () => {
    renderLayout(createAuthenticatedSessionAdapter());

    expect(await screen.findByText('Authenticated content')).toBeInTheDocument();
  });

  it('should preserve the query string when redirecting an anonymous session to /login', async () => {
    renderLayout(undefined, {
      initialEntry: '/?utm_source=email&utm_campaign=demo_invite_2026_07',
      loginElement: <SearchEchoLoginSentinel />,
    });

    expect(
      await screen.findByText(
        'Login page search: ?utm_source=email&utm_campaign=demo_invite_2026_07'
      )
    ).toBeInTheDocument();
  });

  it('should redirect a demo viewer without consent to /consent, carrying the requested path', async () => {
    renderLayout(createAuthenticatedSessionAdapter(demoViewer(false)), {
      initialEntry: '/',
      apiClient: demoModeApiClient(true),
    });

    expect(await screen.findByText('Consent page next: ?next=%2F')).toBeInTheDocument();
  });

  it('should render children for a demo viewer that has consented', async () => {
    renderLayout(createAuthenticatedSessionAdapter(demoViewer(true)), {
      apiClient: demoModeApiClient(true),
    });

    expect(await screen.findByText('Authenticated content')).toBeInTheDocument();
  });

  it('should not gate an admin session on a demo instance', async () => {
    // Admin and operator accounts on a demo instance are the operators' own —
    // gating them would block live support (#1938).
    renderLayout(createAuthenticatedSessionAdapter(), { apiClient: demoModeApiClient(true) });

    expect(await screen.findByText('Authenticated content')).toBeInTheDocument();
  });

  it('should not gate a viewer without consent outside demo mode', async () => {
    renderLayout(createAuthenticatedSessionAdapter(demoViewer(false)), {
      apiClient: demoModeApiClient(false),
    });

    expect(await screen.findByText('Authenticated content')).toBeInTheDocument();
  });

  describe('a bench-only session (#3096, F-9)', () => {
    it.each(['/', '/orders/ol_order_1', '/fulfillment/works/ol_fwork_1'])(
      'should send a packer to the bench when they open %s',
      async (initialEntry) => {
        renderLayout(createAuthenticatedSessionAdapter(PACKER), { initialEntry });

        expect(await screen.findByText('Bench page')).toBeInTheDocument();
        expect(screen.queryByText('Authenticated content')).not.toBeInTheDocument();
      }
    );

    it('should never render the app shell for a packer, even while the config is loading', async () => {
      const neverResolves = new Promise(() => {});
      renderLayout(createAuthenticatedSessionAdapter(PACKER), {
        apiClient: createMockApiClient({
          system: { getConfig: vi.fn().mockReturnValue(neverResolves) },
        } as Partial<ApiClient>),
      });

      expect(await screen.findByText('Bench page')).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
      expect(screen.queryByText('Loading application shell')).not.toBeInTheDocument();
    });

    it('should keep a viewer in the app when they hold orders:read', async () => {
      renderLayout(
        createAuthenticatedSessionAdapter({
          ...PACKER,
          role: 'viewer',
          permissions: ['orders:read'],
        }),
        { initialEntry: '/orders/ol_order_1' }
      );

      expect(await screen.findByText('Authenticated content')).toBeInTheDocument();
    });
  });

  it('should carry a deep link to /login as next when an anonymous session opens it', async () => {
    renderLayout(undefined, {
      initialEntry: '/orders/ol_order_1?tab=items',
      loginElement: <SearchEchoLoginSentinel />,
    });

    expect(
      await screen.findByText(
        `Login page search: ?tab=items&next=${encodeURIComponent('/orders/ol_order_1?tab=items')}`
      )
    ).toBeInTheDocument();
  });

  it('should not render app routes while the demo-mode config is still loading (#1938)', async () => {
    // Found by the Playwright run on this branch: with `demoMode` defaulting to
    // false on first paint, a consent-less demo account rendered the app for a
    // frame (and fired the reads the API was about to 403) before the redirect.
    const neverResolves = new Promise(() => {});
    renderLayout(createAuthenticatedSessionAdapter(demoViewer(false)), {
      apiClient: createMockApiClient({
        system: { getConfig: vi.fn().mockReturnValue(neverResolves) },
      } as Partial<ApiClient>),
    });

    expect(await screen.findByText('Loading application shell')).toBeInTheDocument();
    expect(screen.queryByText('Authenticated content')).not.toBeInTheDocument();
  });
});
