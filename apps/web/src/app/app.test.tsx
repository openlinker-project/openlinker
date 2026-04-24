import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { createAuthenticatedSessionAdapter, createMockApiClient } from '../test/test-utils';
import { ApiClientProvider } from './api/api-client-provider';
import { rootRoute } from './routes/root.route';
import { SessionProvider } from '../shared/auth/session-provider';
import { ToastProvider } from '../shared/ui/toast-provider';

interface RenderAppResult {
  router: ReturnType<typeof createMemoryRouter>;
  view: ReturnType<typeof render>;
}

function renderApp(
  initialEntries: string[],
  sessionAdapter = createAuthenticatedSessionAdapter(),
): RenderAppResult {
  const router = createMemoryRouter([rootRoute], { initialEntries });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const apiClient = createMockApiClient();

  const view = render(
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

  return { router, view };
}

describe('App', () => {
  it('renders the authenticated shell for live routes', async () => {
    const { view } = renderApp(['/']);

    expect(
      await screen.findByRole('heading', { name: 'Operations overview' }, { timeout: 10000 }),
    ).toBeInTheDocument();
    const primaryNavigation = within(view.container).getByRole('navigation', {
      name: 'Primary',
    });
    expect(within(primaryNavigation).getByText('Connections').closest('a')).toHaveAttribute(
      'href',
      '/connections',
    );
    expect(screen.getAllByText(/^(Dev|Development)$/)).not.toHaveLength(0);
  });

  it('renders orders list page from the primary navigation', async () => {
    const { view } = renderApp(['/orders']);

    expect(await screen.findByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    const primaryNavigation = within(view.container).getByRole('navigation', {
      name: 'Primary',
    });
    expect(within(primaryNavigation).getByText('Orders').closest('a')).toHaveAttribute(
      'href',
      '/orders',
    );
  });

  it('redirects legacy /settings/prompt-templates to /ai/prompt-templates (#377)', async () => {
    const { router } = renderApp(['/settings/prompt-templates']);

    // `<Navigate replace>` fires on first render; wait for the router's
    // location to reflect the target path.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/ai/prompt-templates');
    });
  });

  it('redirects legacy /settings/prompt-templates/:id to /ai/prompt-templates/:id (#377)', async () => {
    const { router } = renderApp(['/settings/prompt-templates/tmpl-42']);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/ai/prompt-templates/tmpl-42');
    });
  });
});
