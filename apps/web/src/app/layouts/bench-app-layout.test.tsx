/**
 * Bench app layout (#3653)
 *
 * `/bench` renders the application's own `ShellTopbar` with no sidebar. What
 * is asserted here is what the bench-only topbar used to get wrong or leave
 * out: the logo, the signed-in packer's name (story A4), a user menu whose
 * Sign out lands on `/login`, and no search for a packer.
 *
 * @module app/layouts
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { BenchAppLayout } from './bench-app-layout';
import { SessionProvider } from '../../shared/auth/session-provider';
import type { SessionAdapter } from '../../shared/auth/session-adapter';
import type { SessionUser } from '../../shared/auth/session.types';
import { ToastProvider } from '../../shared/ui/toast-provider';
import { ApiClientProvider } from '../api/api-client-provider';
import { ThemeProvider } from '../../shared/theme/theme-provider';
import { LocaleProvider } from '../../shared/i18n';
import type { RouteCrumbHandle } from '../nav-registry.types';
import { createAuthenticatedSessionAdapter, createMockApiClient } from '../../test/test-utils';

const benchCrumb: RouteCrumbHandle = { crumb: { group: 'Operations', title: 'Pack bench' } };

const PACKER: SessionUser = {
  id: 'user_packer',
  username: 'jon_smith_packer',
  email: 'packer@example.com',
  role: 'packer',
  permissions: ['bench:write'],
  analyticsConsent: true,
};

function renderBench(adapter: SessionAdapter): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: '/bench',
        handle: benchCrumb,
        element: (
          <BenchAppLayout>
            <div data-testid="bench-body-stub">bench</div>
            <Outlet />
          </BenchAppLayout>
        ),
      },
      { path: '/login', element: <p>Login page</p> },
    ],
    { initialEntries: ['/bench'] }
  );

  return render(
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

function renderWithUser(user: SessionUser): ReturnType<typeof render> {
  return renderBench(createAuthenticatedSessionAdapter(user));
}

describe('BenchAppLayout (#3653)', () => {
  it('renders the application topbar with the logo and the bench crumb', async () => {
    const { container } = renderWithUser(PACKER);

    await screen.findByRole('button', { name: /Account menu for jon_smith_packer/i });
    expect(container.querySelector('.shell-topbar .shell-brand__mark')).toHaveAttribute(
      'src',
      '/openlinker-logo.svg'
    );
    expect(screen.getByText('Pack bench')).toBeInTheDocument();
    expect(screen.getByTestId('bench-body-stub')).toBeInTheDocument();
  });

  it('renders no sidebar and no menu button, because there is nothing to open', async () => {
    const { container } = renderWithUser(PACKER);

    await screen.findByRole('button', { name: /Account menu for/i });
    expect(screen.queryByRole('button', { name: 'Open menu' })).not.toBeInTheDocument();
    expect(container.querySelector('.shell-sidebar')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
  });

  it('A4 - names the signed-in packer without any interaction', async () => {
    renderWithUser(PACKER);

    expect(
      await screen.findByRole('button', { name: /Account menu for jon_smith_packer/i })
    ).toBeInTheDocument();
  });

  it('should render the packer name inside the bench-scoped shell when signed in (A4)', async () => {
    // jsdom applies no stylesheet, so the narrow-width half of A4 is asserted
    // against `index.css` in `bench-app-layout-styles.test.ts`; this pins the
    // other half - the class that rule is scoped to is really on the bench.
    const { container } = renderWithUser(PACKER);

    await screen.findByRole('button', { name: /Account menu for jon_smith_packer/i });
    expect(container.querySelector('.shell--bench .shell-user-chip__name')).toHaveTextContent(
      'jon_smith_packer'
    );
  });

  it('offers a packer no search, since every other page sends them back here', async () => {
    renderWithUser(PACKER);

    await screen.findByRole('button', { name: /Account menu for/i });
    expect(
      screen.queryByRole('button', { name: /Open command palette/i })
    ).not.toBeInTheDocument();
  });

  it('keeps the search for an admin looking at the floor', async () => {
    renderBench(createAuthenticatedSessionAdapter());

    expect(
      await screen.findByRole('button', { name: /Open command palette/i })
    ).toBeInTheDocument();
  });

  it('signs out to /login, like every other page', async () => {
    const user = userEvent.setup();
    renderWithUser(PACKER);

    await user.click(await screen.findByRole('button', { name: /Account menu for/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));

    expect(await screen.findByText('Login page')).toBeInTheDocument();
    expect(screen.queryByTestId('bench-body-stub')).not.toBeInTheDocument();
  });
});
