import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ConfirmEmailStatus } from './ConfirmEmailStatus';

describe('ConfirmEmailStatus', () => {
  afterEach(cleanup);

  it('shows a pending message while the confirmation request is in flight', () => {
    const apiClient = createMockApiClient({
      auth: { confirmEmail: vi.fn().mockReturnValue(new Promise(() => {})) },
    });

    renderWithProviders(<ConfirmEmailStatus token="raw-token" />, { apiClient });

    expect(screen.getByText(/confirming your email/i)).toBeInTheDocument();
  });

  it('shows the success state and a sign-in link once confirmation succeeds', async () => {
    const apiClient = createMockApiClient({
      auth: { confirmEmail: vi.fn().mockResolvedValue({ ok: true }) },
    });

    renderWithProviders(<ConfirmEmailStatus token="raw-token" />, { apiClient });

    expect(await screen.findByText(/you're all set/i)).toBeInTheDocument();
    expect(
      screen.getByText(/your email is confirmed and your account is now active/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /continue to sign in/i })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('shows an error state with a retry option and a way back to sign-in when confirmation fails', async () => {
    const confirmEmail = vi.fn().mockRejectedValue(new Error('Invalid or expired token'));
    const apiClient = createMockApiClient({ auth: { confirmEmail } });

    renderWithProviders(<ConfirmEmailStatus token="raw-token" />, { apiClient });

    expect(await screen.findByText(/we couldn't confirm this link/i)).toBeInTheDocument();
    expect(screen.getByText('Invalid or expired token')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(confirmEmail).toHaveBeenCalledWith({ token: 'raw-token' });
    expect(confirmEmail).toHaveBeenCalledTimes(1);

    confirmEmail.mockResolvedValueOnce({ ok: true });
    screen.getByRole('button', { name: /try again/i }).click();

    expect(await screen.findByText(/you're all set/i)).toBeInTheDocument();
    expect(confirmEmail).toHaveBeenCalledTimes(2);
  });

  it('fires the confirmation request exactly once per mount', () => {
    const confirmEmail = vi.fn().mockReturnValue(new Promise(() => {}));
    const apiClient = createMockApiClient({ auth: { confirmEmail } });

    renderWithProviders(<ConfirmEmailStatus token="raw-token" />, { apiClient });

    expect(confirmEmail).toHaveBeenCalledTimes(1);
  });
});
