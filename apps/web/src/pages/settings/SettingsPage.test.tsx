import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createAuthenticatedSessionAdapter, renderWithProviders } from '../../test/test-utils';
import { SettingsPage } from './settings-page';

describe('SettingsPage', () => {
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

    expect(await screen.findByText('admin')).toBeInTheDocument();
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
  });

  it('shows placeholder sections for upcoming features', () => {
    renderWithProviders(<SettingsPage />);

    // Placeholder panels are static — always rendered regardless of session state
    const headingNames = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headingNames).toContain('Notifications');
    expect(headingNames).toContain('Organization');
    expect(headingNames).toContain('Preferences');
  });
});
