/**
 * AppShell Tests
 *
 * Smoke tests for the authenticated-app chrome: nav-group composition,
 * breadcrumb resolution, mobile-drawer open/close behaviour, and regression
 * guards against dead UI in the topbar.
 *
 * @module shared/ui
 */
import type { ReactElement, ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryRouter,
  useNavigate,
  type RouteObject,
} from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './app-shell';
import type { RouteCrumbHandle } from './nav-registry.types';
import { NAV_DEMO_RESTRICTED_MESSAGE } from '../shared/config/demo-mode';
import { SessionProvider } from '../shared/auth/session-provider';
import type { SessionAdapter } from '../shared/auth/session-adapter';
import { ToastProvider } from '../shared/ui/toast-provider';
import { ApiClientProvider } from './api/api-client-provider';
import type { ApiClient } from './api/api-client';
import { ThemeProvider } from '../shared/theme/theme-provider';
import { LocaleProvider } from '../shared/i18n';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
} from '../test/test-utils';

const captureDemoEvent = vi.fn();
vi.mock('../features/demo', async (): Promise<object> => {
  const actual = await vi.importActual<object>('../features/demo');
  return { ...actual, captureDemoEvent: (...args: unknown[]): unknown => captureDemoEvent(...args) };
});

interface RenderShellOptions {
  apiClient?: ApiClient;
  pathname?: string;
  sessionAdapter?: SessionAdapter;
}

const PAGE_CONTENT = <div data-testid="page-content">Page content</div>;

const dashboardCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Dashboard' },
};
const connectionsCrumb: RouteCrumbHandle = {
  crumb: { group: 'Platform', title: 'Connections' },
};

function ShellLayout({ children }: { children: ReactNode }): ReactElement {
  return <AppShell>{children}</AppShell>;
}

/**
 * Build a minimal data-router tree wrapping `AppShell`. We can't use the
 * real `rootRoute` here — it imports lazy page modules that pull the full
 * feature graph — but we mirror the route shape the shell expects:
 * an outer layout route whose children carry the crumb `handle`s the test
 * pathnames need. The wildcard `*` child has no handle so the
 * unknown-routes fallback test exercises the `DEFAULT_CRUMB` branch.
 */
function buildShellRouter(pathname: string): ReturnType<typeof createMemoryRouter> {
  const routes: RouteObject[] = [
    {
      path: '/',
      element: (
        <ShellLayout>
          <Outlet />
        </ShellLayout>
      ),
      children: [
        { index: true, handle: dashboardCrumb, element: PAGE_CONTENT },
        { path: 'connections', handle: connectionsCrumb, element: PAGE_CONTENT },
        { path: 'orders', element: PAGE_CONTENT },
        { path: '*', element: PAGE_CONTENT },
      ],
    },
  ];
  return createMemoryRouter(routes, { initialEntries: [pathname] });
}

function renderShell({
  apiClient = createMockApiClient(),
  pathname = '/',
  sessionAdapter,
}: RenderShellOptions = {}): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const adapter = sessionAdapter ?? createAuthenticatedSessionAdapter();
  const router = buildShellRouter(pathname);

  return render(
    <ThemeProvider>
      <LocaleProvider>
        <SessionProvider adapter={adapter}>
          <ToastProvider>
            <ApiClientProvider client={apiClient}>
              <QueryClientProvider client={queryClient}>
                <RouterProvider router={router} />
              </QueryClientProvider>
            </ApiClientProvider>
          </ToastProvider>
        </SessionProvider>
      </LocaleProvider>
    </ThemeProvider>,
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
  afterEach(() => {
    cleanup();
    captureDemoEvent.mockClear();
  });

  it('renders the three live nav groups plus a disabled Planned footer', () => {
    renderShell({ pathname: '/' });

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

  it('renders the AI group with a Prompt templates link for admin sessions (#377)', async () => {
    renderShell({ pathname: '/' });
    const primary = screen.getByRole('navigation', { name: 'Primary' });
    // AI group renders only once the session resolves to admin, so use `find`.
    const promptTemplates = await within(primary).findByText('Prompt templates');
    expect(within(primary).getByText('AI')).toBeInTheDocument();
    expect(promptTemplates.closest('a')).toHaveAttribute('href', '/ai/prompt-templates');
  });

  it('hides the AI nav group from non-admin sessions (#377)', async () => {
    const viewerAdapter = createAuthenticatedSessionAdapter({
      id: 'u2',
      username: 'viewer',
      email: 'viewer@example.com',
      role: 'viewer',
      permissions: [],
      analyticsConsent: true,
    });
    renderShell({ pathname: '/', sessionAdapter: viewerAdapter });
    // Wait for the viewer username to land in the DOM — a reliable signal
    // that the session has resolved, without depending on a specific
    // component's aria-label wording. Only then is the absence assertion
    // meaningful.
    await screen.findAllByText('viewer');
    const primary = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(primary).queryByText('AI')).toBeNull();
    expect(within(primary).queryByText('Prompt templates')).toBeNull();
  });

  it('locks AI and Administration for a non-admin in demo mode (#1379)', async () => {
    const viewerAdapter = createAuthenticatedSessionAdapter({
      id: 'u2',
      username: 'viewer',
      email: 'viewer@example.com',
      role: 'viewer',
      permissions: [],
      analyticsConsent: true,
    });
    const demoApiClient = createMockApiClient({
      system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
    });
    renderShell({ pathname: '/', apiClient: demoApiClient, sessionAdapter: viewerAdapter });

    const primary = screen.getByRole('navigation', { name: 'Primary' });
    // Wait for the demo-mode config to resolve and transform the groups.
    const users = await within(primary).findByText('Users');

    const usersLink = users.closest('.shell-nav__link');
    expect(usersLink).toHaveAttribute('aria-disabled', 'true');
    expect(usersLink).toHaveAttribute('title', NAV_DEMO_RESTRICTED_MESSAGE);
    // The group is visible but its items are not navigable links.
    expect(users.closest('a')).toBeNull();
    // A lock glyph reads the state at a glance (no hover required).
    expect(usersLink?.querySelector('.shell-nav__link-lock')).not.toBeNull();

    // AI group is locked the same way — its item is present but not a link.
    const promptTemplates = within(primary).getByText('Prompt templates');
    expect(promptTemplates.closest('a')).toBeNull();
    expect(promptTemplates.closest('.shell-nav__link')).toHaveAttribute(
      'title',
      NAV_DEMO_RESTRICTED_MESSAGE,
    );
  });

  it('keeps AI and Administration live for an admin in demo mode (#1379)', async () => {
    const demoApiClient = createMockApiClient({
      system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
    });
    renderShell({ pathname: '/', apiClient: demoApiClient });

    const primary = screen.getByRole('navigation', { name: 'Primary' });
    // Admin keeps navigable links even in demo mode.
    const promptTemplates = await within(primary).findByText('Prompt templates');
    expect(promptTemplates.closest('a')).toHaveAttribute('href', '/ai/prompt-templates');
  });

  it('shows the demo banner for a viewer session in demo mode (#1468)', async () => {
    const viewerAdapter = createAuthenticatedSessionAdapter({
      id: 'u2',
      username: 'viewer',
      email: 'viewer@example.com',
      role: 'viewer',
      permissions: [],
      analyticsConsent: true,
    });
    const demoApiClient = createMockApiClient({
      system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
    });
    renderShell({ pathname: '/', apiClient: demoApiClient, sessionAdapter: viewerAdapter });

    expect(await screen.findByRole('note', { name: 'Demo mode notice' })).toBeInTheDocument();
  });

  it('hides the demo banner for an admin session in demo mode (#1468)', async () => {
    const demoApiClient = createMockApiClient({
      system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
    });
    renderShell({ pathname: '/', apiClient: demoApiClient });

    // Wait for the demo-mode config to resolve (same signal the sibling
    // nav-lock tests use) before asserting the banner's absence. Scoped to
    // the primary nav — desktop + mobile drawer both render the label.
    const primary = screen.getByRole('navigation', { name: 'Primary' });
    await within(primary).findByText('Prompt templates');
    expect(screen.queryByRole('note', { name: 'Demo mode notice' })).toBeNull();
  });

  it('uses "Connections" as the nav label (not "Integrations")', () => {
    renderShell({ pathname: '/' });
    const primary = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(primary).getByText('Connections')).toBeInTheDocument();
    expect(within(primary).queryByText('Integrations')).toBeNull();
  });

  it('does not render any "Live" pill on live nav items', () => {
    renderShell({ pathname: '/' });
    const primary = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(primary).queryByText('Live')).toBeNull();
  });

  it('shows a breadcrumb reflecting the current route', () => {
    renderShell({ pathname: '/connections' });
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('Platform')).toBeInTheDocument();
    expect(within(crumbs).getByText('Connections')).toBeInTheDocument();
  });

  it('falls back to an OpenLinker crumb for unknown routes', () => {
    renderShell({ pathname: '/totally-not-a-route' });
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('OpenLinker')).toBeInTheDocument();
  });

  it('exposes a hamburger trigger for the mobile drawer', () => {
    renderShell({ pathname: '/' });
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
  });

  it('should not render a native searchbox role — cmdk uses a text input (#333)', () => {
    // Regression for #220: the topbar previously rendered an <Input type="search">
    // with no handler. The command palette (#333) uses cmdk's <input type="text">,
    // which does not carry the implicit "searchbox" ARIA role, so this guard stays valid.
    renderShell({ pathname: '/' });
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('renders the child page content', () => {
    renderShell({ pathname: '/' });
    expect(screen.getByTestId('page-content')).toHaveTextContent('Page content');
  });

  it('shows the ⌘K command palette trigger in the topbar', () => {
    renderShell({ pathname: '/' });
    const search = screen.getByRole('button', { name: /open command palette/i });
    expect(search).toBeInTheDocument();
    expect(search.textContent).toMatch(/⌘K/);
  });

  it('renders count badges from useNavCounts once queries settle', async () => {
    const apiClient = createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]),
      },
      orders: {
        list: vi.fn().mockResolvedValue({ items: [], total: 37, limit: 1, offset: 0 }),
      },
    });

    renderShell({ apiClient });

    const primary = screen.getByRole('navigation', { name: 'Primary' });
    await waitFor(() => {
      expect(within(primary).getByText('37')).toBeInTheDocument();
      expect(within(primary).getByText('2')).toBeInTheDocument();
    });
  });

  it('exposes a user chip that opens an account menu with sign out and theme toggle', async () => {
    const user = userEvent.setup();
    renderShell({ pathname: '/' });

    const trigger = await screen.findByRole('button', { name: /Account menu for/i });
    await user.click(trigger);

    expect(await screen.findByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
  });

  it('opens the mobile drawer when the hamburger is clicked', () => {
    renderShell({ pathname: '/' });

    const drawer = getDrawer();
    expect(drawer.open).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(drawer.open).toBe(true);

    const mobileNav = screen.getByRole('navigation', { name: 'Primary (mobile)' });
    expect(within(mobileNav).getByText('Orders')).toBeInTheDocument();
  });

  it('closes the drawer when the Close button is clicked', () => {
    renderShell({ pathname: '/' });

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
    const apiClient = createMockApiClient();

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <AppShell>
              <Outlet />
            </AppShell>
          ),
          children: [
            { index: true, handle: dashboardCrumb, element: <Redirector to="/orders" /> },
            { path: 'orders', element: PAGE_CONTENT },
          ],
        },
      ],
      { initialEntries: ['/'] },
    );

    render(
      <ThemeProvider>
        <LocaleProvider>
          <SessionProvider adapter={adapter}>
            <ToastProvider>
              <ApiClientProvider client={apiClient}>
                <QueryClientProvider client={queryClient}>
                  <RouterProvider router={router} />
                </QueryClientProvider>
              </ApiClientProvider>
            </ToastProvider>
          </SessionProvider>
        </LocaleProvider>
      </ThemeProvider>,
    );

    const drawer = getDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(drawer.open).toBe(true);

    act(() => {
      fireEvent.click(screen.getByTestId('go'));
    });

    expect(drawer.open).toBe(false);
  });

  describe('open-source link + analytics opt-out demo events (#1790)', () => {
    it('renders the "View on GitHub" link in demo mode and fires demo_opensource_link_clicked on click', async () => {
      const demoApiClient = createMockApiClient({
        system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
      });
      renderShell({ pathname: '/', apiClient: demoApiClient });

      const user = userEvent.setup();
      const links = await screen.findAllByRole('link', { name: /View on GitHub/ });
      expect(links.length).toBeGreaterThan(0);
      expect(links[0]).toHaveAttribute('href', 'https://github.com/openlinker-project/openlinker');

      await user.click(links[0]);

      expect(captureDemoEvent).toHaveBeenCalledWith('demo_opensource_link_clicked', {
        location: 'sidebar_footer',
      });
    });

    it('does not render the "View on GitHub" link outside demo mode', async () => {
      renderShell({ pathname: '/' });

      // Wait for the (non-demo) system config to resolve before asserting absence.
      const primary = screen.getByRole('navigation', { name: 'Primary' });
      await within(primary).findByText('Prompt templates');
      expect(screen.queryByRole('link', { name: /View on GitHub/ })).toBeNull();
    });

    it('fires demo_analytics_disabled when the viewer clicks Disable in the demo banner', async () => {
      const viewerAdapter = createAuthenticatedSessionAdapter({
        id: 'u2',
        username: 'viewer',
        email: 'viewer@example.com',
        role: 'viewer',
        permissions: [],
        analyticsConsent: true,
      });
      const demoApiClient = createMockApiClient({
        system: {
          getConfig: vi.fn().mockResolvedValue({
            demoMode: true,
            demoIntegrations: {
              posthog: {
                key: 'phc_abc',
                host: 'https://eu.posthog.com',
                autocapture: true,
                sessionRecording: false,
                productEventsEnabled: true,
                enabledEventGroups: ['baseline'],
              },
            },
          }),
        },
      });
      renderShell({ pathname: '/', apiClient: demoApiClient, sessionAdapter: viewerAdapter });

      const user = userEvent.setup();
      const disableButton = await screen.findByRole('button', { name: 'Disable' });
      await user.click(disableButton);

      expect(captureDemoEvent).toHaveBeenCalledWith('demo_analytics_disabled', {});
    });
  });
});
