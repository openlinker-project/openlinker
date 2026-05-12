import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthenticatedAppLayout } from './authenticated-app-layout';
import { ApiClientProvider } from '../api/api-client-provider';
import type { SessionAdapter } from '../../shared/auth/session-adapter';
import { SessionProvider } from '../../shared/auth/session-provider';
import { ThemeProvider } from '../../shared/theme/theme-provider';
import { ToastProvider } from '../../shared/ui/toast-provider';
import { createNoopSessionAdapter } from '../../shared/auth/noop-session-adapter';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
} from '../../test/test-utils';
import type { RouteCrumbHandle } from '../nav-registry.types';

function TestChild(): React.ReactElement {
  return <div>Authenticated content</div>;
}

function LoginSentinel(): React.ReactElement {
  return <div>Login page</div>;
}

const indexCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Dashboard' },
};

function renderLayout(sessionAdapter?: SessionAdapter): void {
  const adapter = sessionAdapter ?? createNoopSessionAdapter();
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AuthenticatedAppLayout />,
        children: [{ index: true, handle: indexCrumb, element: <TestChild /> }],
      },
      { path: '/login', element: <LoginSentinel /> },
    ],
    { initialEntries: ['/'] },
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <ThemeProvider>
      <SessionProvider adapter={adapter}>
        <ToastProvider>
          <ApiClientProvider client={createMockApiClient()}>
            <QueryClientProvider client={queryClient}>
              <RouterProvider router={router} />
            </QueryClientProvider>
          </ApiClientProvider>
        </ToastProvider>
      </SessionProvider>
    </ThemeProvider>,
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
});
