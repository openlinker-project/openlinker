import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import { SettingsPage } from './settings-page';

describe('SettingsPage', () => {
  afterEach(cleanup);

  it('shows environment info', () => {
    renderWithProviders(<SettingsPage />);

    expect(screen.getByRole('heading', { name: 'Environment and account' })).toBeInTheDocument();
    // env.ts defaults: 'development' and 'http://localhost:3000'
    expect(screen.getByText('development')).toBeInTheDocument();
    expect(screen.getByText('http://localhost:3000')).toBeInTheDocument();
  });

  it('shows loading state before session is ready', () => {
    // Adapter whose getSession never resolves — isReady stays false
    renderWithProviders(<SettingsPage />, {
      sessionAdapter: {
        getSession: () => new Promise(() => {}),
        getAccessToken: () => new Promise(() => {}),
        persistSession: async () => {},
        clearSession: async () => {},
      },
    });

    expect(screen.getByText('Loading session…')).toBeInTheDocument();
  });

  it('shows anonymous state when no user is authenticated', async () => {
    // Default noop adapter returns anonymous session
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText('No active session.')).toBeInTheDocument();
  });

  it('shows authenticated user info', async () => {
    renderWithProviders(<SettingsPage />, {
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByText('admin@example.com')).toBeInTheDocument();
    // username and role both render as 'admin' — expect both <dd> values
    expect(screen.getAllByText('admin')).toHaveLength(2);
    expect(screen.getByText('Role')).toBeInTheDocument();
  });

  it('says what is planned in one line instead of placeholder sections', () => {
    renderWithProviders(<SettingsPage />);

    expect(
      screen.getByText('Also planned: notifications, organization, preferences.'),
    ).toBeInTheDocument();
    const headingNames = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headingNames).not.toContain('Notifications');
  });

  it('shows the Mailer tile for an admin session', async () => {
    renderWithProviders(<SettingsPage />, {
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    // The row is locked until the session resolves, so wait for the admin.
    expect(await screen.findByText('admin@example.com')).toBeInTheDocument();
    const row = screen.getByRole('heading', { name: 'Mailer' }).closest('li');
    expect(within(row as HTMLElement).queryByRole('img', { name: /Administrators only/ })).not.toBeInTheDocument();
  });

  it('shows the Buyer data row with a way in for an admin and locked for a viewer (#4289)', async () => {
    const admin = renderWithProviders(<SettingsPage />, {
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    const adminRow = (await screen.findByRole('heading', { name: 'Buyer data' })).closest('li');
    expect(adminRow).not.toBeNull();
    expect(within(adminRow as HTMLElement).getByRole('link', { name: 'Manage' })).toBeInTheDocument();
    admin.unmount();

    renderWithProviders(<SettingsPage />, {
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'user_2',
        username: 'viewer',
        email: 'viewer@example.com',
        role: 'viewer',
        permissions: [],
        analyticsConsent: true,
      }),
    });
    expect(await screen.findByText('viewer@example.com')).toBeInTheDocument();
    const viewerRow = screen.getByRole('heading', { name: 'Buyer data' }).closest('li');
    expect(viewerRow).not.toBeNull();
    expect(within(viewerRow as HTMLElement).queryByRole('link')).not.toBeInTheDocument();
    expect(
      within(viewerRow as HTMLElement).getByRole('img', { name: /Administrators only/ }),
    ).toBeInTheDocument();
  });

  it('lists the Mailer row as locked, with no way in, for a non-admin session', async () => {
    renderWithProviders(<SettingsPage />, {
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'user_2',
        username: 'viewer',
        email: 'viewer@example.com',
        role: 'viewer',
        permissions: [],
        analyticsConsent: true,
      }),
    });

    // The row stays readable so nobody has to guess the area exists, but it
    // carries no action and never mounts the admin-only data read.
    expect(await screen.findByText('viewer@example.com')).toBeInTheDocument();
    const row = screen.getByRole('heading', { name: 'Mailer' }).closest('li');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).queryByRole('button')).not.toBeInTheDocument();
    expect(within(row as HTMLElement).getByRole('img', { name: /Administrators only/ })).toBeInTheDocument();
  });

  /**
   * The opposite expectation, deliberately adjacent to the one above.
   *
   * Every other settings tile is `{isAdmin ? <XTile /> : null}`, so this one is
   * the exception and a plan document is not enough to keep it — a lone
   * deviation from five siblings is a deviation the next contributor "fixes".
   * #2353 authorises `GET /fulfillment-authority/status` for a read-only role
   * SPECIFICALLY so that role can see who decides what, and #2354's acceptance
   * criteria require it; gating the tile would make the page unreachable for
   * exactly the role the endpoint was widened for.
   */
  it('always renders the Who decides what tile, including for a non-admin session', async () => {
    renderWithProviders(<SettingsPage />, {
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'user_3',
        username: 'viewer',
        email: 'viewer2@example.com',
        role: 'viewer',
        permissions: [],
        analyticsConsent: true,
      }),
    });

    expect(await screen.findByText('viewer2@example.com')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Who decides what' }),
    ).toBeInTheDocument();
  });

  describe('with the OMS routing UI flag on (#3634)', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_OL_OMS_ROUTING_UI_ENABLED', 'true');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('shows the Sourcing rules tile for an admin session', async () => {
      renderWithProviders(<SettingsPage />, {
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });

      expect(await screen.findByRole('heading', { name: 'Sourcing rules' })).toBeInTheDocument();
    });

    /**
     * The gate is the `{isAdmin ? … : null}` at the MOUNT SITE, so it can only be
     * asserted here. `sourcing-rules-tile.test.tsx` renders the tile in isolation
     * and would pass with the gate deleted.
     *
     * Admin-gated rather than ungated like `WhoDecidesTile` above, because the
     * sourcing-rules API carries a class-level `@Roles('admin')` covering its
     * reads too (#2953) — a non-admin reaching the page meets a 403, not a
     * read-only view.
     */
    it('lists the Sourcing rules row as locked for a non-admin session', async () => {
      renderWithProviders(<SettingsPage />, {
        sessionAdapter: createAuthenticatedSessionAdapter({
          id: 'user_4',
          username: 'viewer',
          email: 'viewer3@example.com',
          role: 'viewer',
          permissions: [],
          analyticsConsent: true,
        }),
      });

      expect(await screen.findByText('viewer3@example.com')).toBeInTheDocument();
      const row = screen.getByRole('heading', { name: 'Sourcing rules' }).closest('li');
      expect(within(row as HTMLElement).queryByRole('link')).not.toBeInTheDocument();
      expect(within(row as HTMLElement).getByRole('img', { name: /Administrators only/ })).toBeInTheDocument();
    });

    /**
     * Same deviation, same reason: `InventoryLocationsController`'s reads are
     * `@Roles('admin', 'operator', 'viewer')` and the sidebar nav entry is
     * already gated on `inventory:read`, not on being an admin — gating this
     * link-out tile to admin-only would make it LESS reachable than the nav
     * item pointing at the same page.
     */
    it('always renders the Inventory locations tile, including for a non-admin session', async () => {
      renderWithProviders(<SettingsPage />, {
        sessionAdapter: createAuthenticatedSessionAdapter({
          id: 'user_4',
          username: 'viewer',
          email: 'viewer3@example.com',
          role: 'viewer',
          permissions: ['inventory:read'],
          analyticsConsent: true,
        }),
      });

      expect(await screen.findByText('viewer3@example.com')).toBeInTheDocument();
      expect(
        await screen.findByRole('heading', { name: 'Inventory locations' }),
      ).toBeInTheDocument();
    });
  });

  it('should render neither OMS routing tile nor chip when the OMS routing UI flag is off (#3634)', async () => {
    renderWithProviders(<SettingsPage />, {
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByRole('heading', { name: 'Who decides what' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sourcing rules' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Inventory locations' })).not.toBeInTheDocument();
  });

  it('shows the PostHog tile for an admin session', async () => {
    renderWithProviders(<SettingsPage />, {
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByText('admin@example.com')).toBeInTheDocument();
    const row = screen.getByRole('heading', { name: 'PostHog' }).closest('li');
    expect(within(row as HTMLElement).queryByRole('img', { name: /Administrators only/ })).not.toBeInTheDocument();
  });

  it('lists the PostHog row as locked for a non-admin session', async () => {
    renderWithProviders(<SettingsPage />, {
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'user_2',
        username: 'viewer',
        email: 'viewer@example.com',
        role: 'viewer',
        permissions: [],
        analyticsConsent: true,
      }),
    });

    expect(await screen.findByText('viewer@example.com')).toBeInTheDocument();
    const row = screen.getByRole('heading', { name: 'PostHog' }).closest('li');
    expect(within(row as HTMLElement).getByRole('img', { name: /Administrators only/ })).toBeInTheDocument();
  });

  it('never renders an analytics consent control, in demo mode or out of it (#1938)', async () => {
    // The demo's consent decision moved to registration and the /consent page;
    // Settings offers no way to switch analytics off any more.
    for (const demoMode of [true, false]) {
      const apiClient = createMockApiClient({
        system: { getConfig: vi.fn().mockResolvedValue({ demoMode }) },
      });

      renderWithProviders(<SettingsPage />, {
        apiClient,
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });

      // The page renders synchronously from the session; there is no consent
      // query left to await.
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument());
      expect(screen.queryByRole('heading', { name: 'Analytics' })).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      cleanup();
    }
  });
});
