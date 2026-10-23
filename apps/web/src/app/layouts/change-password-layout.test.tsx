import { cleanup, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionAdapter } from '../../shared/auth/session-adapter';
import type { Session } from '../../shared/auth/session.types';
import { ANONYMOUS_SESSION } from '../../shared/auth/session.types';
import { renderWithProviders } from '../../test/test-utils';
import { ChangePasswordLayout } from './change-password-layout';

function makeAdapter(session: Session): SessionAdapter {
  return {
    getSession: vi.fn().mockResolvedValue(session),
    getAccessToken: vi.fn().mockResolvedValue('token'),
    persistSession: vi.fn(),
    clearSession: vi.fn(),
    refresh: vi.fn().mockResolvedValue('token'),
  };
}

function authenticated(mustChangePassword: boolean): Session {
  return {
    status: 'authenticated',
    accessToken: 'token',
    user: {
      id: 'user-1',
      username: 'anna',
      email: null,
      role: 'packer',
      permissions: [],
      mustChangePassword,
    },
  };
}

function renderLayout(sessionAdapter: SessionAdapter, route = '/change-password'): void {
  renderWithProviders(
    <Routes>
      <Route path="/change-password" element={<ChangePasswordLayout />}>
        <Route index element={<p>Change password form</p>} />
      </Route>
      <Route path="/orders" element={<p>Orders page</p>} />
      <Route path="/" element={<p>Dashboard page</p>} />
      <Route path="/login" element={<p>Login page</p>} />
    </Routes>,
    { sessionAdapter, route },
  );
}

describe('ChangePasswordLayout', () => {
  afterEach(cleanup);

  it('should render the form for an account that owes a password change', async () => {
    renderLayout(makeAdapter(authenticated(true)));

    expect(await screen.findByText('Change password form')).toBeInTheDocument();
  });

  it('should send an anonymous visitor to the login page', async () => {
    renderLayout(makeAdapter(ANONYMOUS_SESSION));

    await waitFor(() => expect(screen.getByText('Login page')).toBeInTheDocument());
  });

  it('should leave for next when no change is owed', async () => {
    renderLayout(makeAdapter(authenticated(false)), '/change-password?next=%2Forders');

    await waitFor(() => expect(screen.getByText('Orders page')).toBeInTheDocument());
    expect(screen.queryByText('Change password form')).not.toBeInTheDocument();
  });

  it('should fall back to the app root when no next path was carried', async () => {
    renderLayout(makeAdapter(authenticated(false)));

    await waitFor(() => expect(screen.getByText('Dashboard page')).toBeInTheDocument());
  });
});
