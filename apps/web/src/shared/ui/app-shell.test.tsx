import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { AppShell } from './app-shell';
import { SessionProvider } from '../auth/session-provider';
import { ToastProvider } from './toast-provider';
import { createAuthenticatedSessionAdapter } from '../../test/test-utils';

function renderShell(pathname = '/'): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const adapter = createAuthenticatedSessionAdapter();

  return render(
    <SessionProvider adapter={adapter}>
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[pathname]}>
            <AppShell>
              <div data-testid="page-content">Page content</div>
            </AppShell>
          </MemoryRouter>
        </QueryClientProvider>
      </ToastProvider>
    </SessionProvider>,
  );
}

describe('AppShell', () => {
  afterEach(cleanup);

  it('renders the three live nav groups plus a disabled Planned footer', async () => {
    renderShell('/');

    const primary = screen.getAllByRole('navigation', { name: 'Primary' })[0];
    expect(within(primary).getByText('Operations')).toBeInTheDocument();
    expect(within(primary).getByText('Diagnostics')).toBeInTheDocument();
    expect(within(primary).getByText('Platform')).toBeInTheDocument();
    expect(within(primary).getByText('Planned')).toBeInTheDocument();

    // Cursors now lives under Diagnostics, not Operations.
    expect(within(primary).getByText('Cursors').closest('a')).toHaveAttribute('href', '/cursors');

    // Add connection is no longer in nav.
    expect(within(primary).queryByText('Add connection')).toBeNull();

    // Planned items are non-interactive spans with the disabled tooltip.
    const automationsItem = within(primary).getByText('Automations');
    expect(automationsItem.tagName).toBe('SPAN');
    expect(automationsItem).toHaveAttribute('aria-disabled', 'true');
    expect(automationsItem).toHaveAttribute('title', 'Coming in a future release');
  });

  it('uses "Connections" as the nav label (not "Integrations")', () => {
    renderShell('/');
    const primary = screen.getAllByRole('navigation', { name: 'Primary' })[0];
    expect(within(primary).getByText('Connections')).toBeInTheDocument();
    expect(within(primary).queryByText('Integrations')).toBeNull();
  });

  it('does not render any "Live" pill on live nav items', () => {
    renderShell('/');
    const primary = screen.getAllByRole('navigation', { name: 'Primary' })[0];
    expect(within(primary).queryByText('Live')).toBeNull();
  });

  it('shows a breadcrumb reflecting the current route', () => {
    renderShell('/connections');
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('Platform')).toBeInTheDocument();
    expect(within(crumbs).getByText('Connections')).toBeInTheDocument();
  });

  it('exposes a hamburger trigger for the mobile drawer', () => {
    renderShell('/');
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
  });

  it('renders the child page content', () => {
    renderShell('/');
    expect(screen.getByTestId('page-content')).toHaveTextContent('Page content');
  });
});
