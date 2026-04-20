import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
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

function getDrawer(): HTMLDialogElement {
  const drawer = document.querySelector('dialog.shell-drawer');
  if (!(drawer instanceof HTMLDialogElement)) {
    throw new Error('shell drawer dialog not found');
  }
  return drawer;
}

describe('AppShell', () => {
  afterEach(cleanup);

  it('renders the three live nav groups plus a disabled Planned footer', () => {
    renderShell('/');

    const primary = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(primary).getByText('Operations')).toBeInTheDocument();
    expect(within(primary).getByText('Diagnostics')).toBeInTheDocument();
    expect(within(primary).getByText('Platform')).toBeInTheDocument();
    expect(within(primary).getByText('Planned')).toBeInTheDocument();

    expect(within(primary).getByText('Cursors').closest('a')).toHaveAttribute('href', '/cursors');

    expect(within(primary).queryByText('Add connection')).toBeNull();

    const automations = within(primary).getByText('Automations');
    expect(automations).toHaveAttribute('role', 'link');
    expect(automations).toHaveAttribute('aria-disabled', 'true');
    expect(automations).toHaveAttribute('tabindex', '-1');
    expect(automations).toHaveAttribute('title', 'Coming in a future release');
  });

  it('uses "Connections" as the nav label (not "Integrations")', () => {
    renderShell('/');
    const primary = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(primary).getByText('Connections')).toBeInTheDocument();
    expect(within(primary).queryByText('Integrations')).toBeNull();
  });

  it('does not render any "Live" pill on live nav items', () => {
    renderShell('/');
    const primary = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(primary).queryByText('Live')).toBeNull();
  });

  it('shows a breadcrumb reflecting the current route', () => {
    renderShell('/connections');
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('Platform')).toBeInTheDocument();
    expect(within(crumbs).getByText('Connections')).toBeInTheDocument();
  });

  it('falls back to an OpenLinker crumb for unknown routes', () => {
    renderShell('/totally-not-a-route');
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('OpenLinker')).toBeInTheDocument();
  });

  it('exposes a hamburger trigger for the mobile drawer', () => {
    renderShell('/');
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
  });

  it('renders the child page content', () => {
    renderShell('/');
    expect(screen.getByTestId('page-content')).toHaveTextContent('Page content');
  });

  it('opens the mobile drawer when the hamburger is clicked', () => {
    renderShell('/');

    const drawer = getDrawer();
    expect(drawer.open).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(drawer.open).toBe(true);

    const mobileNav = screen.getByRole('navigation', { name: 'Primary (mobile)' });
    expect(within(mobileNav).getByText('Orders')).toBeInTheDocument();
  });

  it('closes the drawer when the Close button is clicked', () => {
    renderShell('/');

    const drawer = getDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(drawer.open).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(drawer.open).toBe(false);
  });

  it('closes the drawer when the route changes externally', () => {
    function Redirector({ to }: { to: string }): ReactElement {
      const navigate = useNavigate();
      return (
        <button
          type="button"
          data-testid="go"
          onClick={() => {
            void navigate(to);
          }}
        >
          go
        </button>
      );
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const adapter = createAuthenticatedSessionAdapter();

    render(
      <SessionProvider adapter={adapter}>
        <ToastProvider>
          <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={['/']}>
              <Routes>
                <Route
                  path="*"
                  element={
                    <AppShell>
                      <Redirector to="/orders" />
                    </AppShell>
                  }
                />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </ToastProvider>
      </SessionProvider>,
    );

    const drawer = getDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(drawer.open).toBe(true);

    act(() => {
      fireEvent.click(screen.getByTestId('go'));
    });

    expect(drawer.open).toBe(false);
  });
});
