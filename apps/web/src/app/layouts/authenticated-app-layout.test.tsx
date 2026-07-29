import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthenticatedAppLayout } from './authenticated-app-layout';
import { ApiClientProvider } from '../api/api-client-provider';
import type { SessionAdapter } from '../../shared/auth/session-adapter';
import { SessionProvider } from '../../shared/auth/session-provider';
import { ThemeProvider } from '../../shared/theme/theme-provider';
import { LocaleProvider } from '../../shared/i18n';
import { ToastProvider } from '../../shared/ui/toast-provider';
import { createNoopSessionAdapter } from '../../shared/auth/noop-session-adapter';
import { createAuthenticatedSessionAdapter, createMockApiClient } from '../../test/test-utils';
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

const indexCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Dashboard' },
};

function renderLayout(
  sessionAdapter?: SessionAdapter,
  options?: { initialEntry?: string; loginElement?: React.ReactElement }
): void {
  const adapter = sessionAdapter ?? createNoopSessionAdapter();
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AuthenticatedAppLayout />,
        children: [{ index: true, handle: indexCrumb, element: <TestChild /> }],
      },
      { path: '/login', element: options?.loginElement ?? <LoginSentinel /> },
    ],
    { initialEntries: [options?.initialEntry ?? '/'] }
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <ThemeProvider>
      <LocaleProvider>
        <SessionProvider adapter={adapter}>
          <ToastProvider>
            <ApiClientProvider client={createMockApiClient()}>
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
});
