import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { createAuthenticatedSessionAdapter, createMockApiClient } from '../test/test-utils';
import { ApiClientProvider } from './api/api-client-provider';
import { rootRoute } from './routes/root.route';
import { SessionProvider } from '../shared/auth/session-provider';
import { ToastProvider } from '../shared/ui/toast-provider';

function renderApp(initialEntries: string[]): ReturnType<typeof render> {
  const router = createMemoryRouter([rootRoute], { initialEntries });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const sessionAdapter = createAuthenticatedSessionAdapter();
  const apiClient = createMockApiClient();

  return render(
    <SessionProvider adapter={sessionAdapter}>
      <ToastProvider>
        <ApiClientProvider client={apiClient}>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </ApiClientProvider>
      </ToastProvider>
    </SessionProvider>,
  );
}

describe('App', () => {
  it('renders the authenticated shell for live routes', async () => {
    const view = renderApp(['/']);

    expect(await screen.findByRole('heading', { name: 'Operations overview' })).toBeInTheDocument();
    const primaryNavigation = within(view.container).getByRole('navigation', { name: 'Primary' });
    expect(within(primaryNavigation).getByText('Integrations').closest('a')).toHaveAttribute('href', '/connections');
    expect(screen.getAllByText('Development')).not.toHaveLength(0);
  });

  it('renders planned placeholder routes from the primary navigation', async () => {
    const view = renderApp(['/orders']);

    expect(await screen.findByRole('heading', { name: 'Orders workspace' })).toBeInTheDocument();
    const primaryNavigation = within(view.container).getByRole('navigation', { name: 'Primary' });
    expect(within(primaryNavigation).getByText('Orders').closest('a')).toHaveAttribute('href', '/orders');
    expect(screen.getByText('Orders is planned')).toBeInTheDocument();
  });
});
