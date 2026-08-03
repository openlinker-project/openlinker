import { cleanup, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionAdapter } from '../../shared/auth/session-adapter';
import type { Session } from '../../shared/auth/session.types';
import { ANONYMOUS_SESSION } from '../../shared/auth/session.types';
import { renderWithProviders } from '../../test/test-utils';
import { ConsentLayout } from './consent-layout';

function makeAdapter(session: Session, refresh = vi.fn().mockResolvedValue('token')): SessionAdapter {
  return {
    getSession: vi.fn().mockResolvedValue(session),
    getAccessToken: vi.fn().mockResolvedValue('token'),
    persistSession: vi.fn(),
    clearSession: vi.fn(),
    refresh,
  };
}

function authenticated(analyticsConsent: boolean): Session {
  return {
    status: 'authenticated',
    accessToken: 'token',
    user: {
      id: 'user-1',
      username: 'demo_visitor',
      email: 'demo@test.com',
      role: 'viewer',
      permissions: [],
      analyticsConsent,
    },
  };
}

function renderLayout(sessionAdapter: SessionAdapter, route = '/consent'): void {
  renderWithProviders(
    <Routes>
      <Route path="/consent" element={<ConsentLayout />}>
        <Route index element={<p>Consent gate</p>} />
      </Route>
      <Route path="/orders" element={<p>Orders page</p>} />
      <Route path="/" element={<p>Dashboard page</p>} />
      <Route path="/login" element={<p>Login page</p>} />
    </Routes>,
    { sessionAdapter, route },
  );
}

describe('ConsentLayout', () => {
  afterEach(cleanup);

  it('should render the gate for an authenticated account without consent', async () => {
    renderLayout(makeAdapter(authenticated(false)));

    expect(await screen.findByText('Consent gate')).toBeInTheDocument();
    expect(screen.getByText('OpenLinker')).toBeInTheDocument();
  });

  it('should send an anonymous visitor to the login page', async () => {
    renderLayout(makeAdapter(ANONYMOUS_SESSION));

    await waitFor(() => expect(screen.getByText('Login page')).toBeInTheDocument());
  });

  it('should re-mint the token and leave when consent is already on the account', async () => {
    // Covers a token issued before the consent claim existed: the account has
    // consented, so it must not be asked again (#1938).
    const refresh = vi.fn().mockResolvedValue('fresh-token');
    renderLayout(makeAdapter(authenticated(true), refresh), '/consent?next=%2Forders');

    await waitFor(() => expect(screen.getByText('Orders page')).toBeInTheDocument());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Consent gate')).not.toBeInTheDocument();
  });

  it('should fall back to the app root when no next path was carried', async () => {
    renderLayout(makeAdapter(authenticated(true)));

    await waitFor(() => expect(screen.getByText('Dashboard page')).toBeInTheDocument());
  });
});
