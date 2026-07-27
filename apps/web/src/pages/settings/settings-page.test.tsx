import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuthenticatedSessionAdapter, renderWithProviders } from '../../test/test-utils';
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
});
