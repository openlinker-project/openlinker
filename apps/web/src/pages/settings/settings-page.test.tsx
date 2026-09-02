import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

    expect(screen.getByRole('heading', { name: 'Environment' })).toBeInTheDocument();
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

  it('shows placeholder sections for upcoming features', () => {
    renderWithProviders(<SettingsPage />);

    // Placeholder panels are static — always rendered regardless of session state
    const headingNames = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headingNames).toContain('Notifications');
    expect(headingNames).toContain('Organization');
    expect(headingNames).toContain('Preferences');
  });

  it('shows the Mailer tile for an admin session', async () => {
    renderWithProviders(<SettingsPage />, {
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByRole('heading', { name: 'Mailer' })).toBeInTheDocument();
    expect(screen.getByText('Mailer', { selector: '.toolbar-chip' })).toBeInTheDocument();
  });

  it('never renders the Mailer tile for a non-admin session', async () => {
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

    // Wait for the authenticated Account tile to confirm session resolution,
    // then assert the Mailer tile is fully absent — not disabled, not present.
    expect(await screen.findByText('viewer@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Mailer' })).not.toBeInTheDocument();
    expect(screen.queryByText('Mailer', { selector: '.toolbar-chip' })).not.toBeInTheDocument();
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
    expect(
      screen.getByText('Who decides what', { selector: '.toolbar-chip' }),
    ).toBeInTheDocument();
  });

  it('shows the PostHog tile for an admin session', async () => {
    renderWithProviders(<SettingsPage />, {
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByRole('heading', { name: 'PostHog' })).toBeInTheDocument();
    expect(screen.getByText('PostHog', { selector: '.toolbar-chip' })).toBeInTheDocument();
  });

  it('never renders the PostHog tile for a non-admin session', async () => {
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
    expect(screen.queryByRole('heading', { name: 'PostHog' })).not.toBeInTheDocument();
    expect(screen.queryByText('PostHog', { selector: '.toolbar-chip' })).not.toBeInTheDocument();
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
      expect(screen.queryByText('Privacy', { selector: '.toolbar-chip' })).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      cleanup();
    }
  });
});
