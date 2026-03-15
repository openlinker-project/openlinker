import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppProviders } from './providers/app-providers';
import { rootRoute } from './routes/root.route';

function renderApp(initialEntries: string[]): ReturnType<typeof render> {
  const router = createMemoryRouter([rootRoute], {
    initialEntries,
  });

  return render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
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
