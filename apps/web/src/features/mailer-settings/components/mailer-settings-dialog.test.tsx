/**
 * Mailer Settings Dialog — Tests
 *
 * Covers prefill (non-secret fields only — password stays blank even when
 * `smtpPasswordConfigured` is true), submit wiring (update, plus a
 * conditional credentials rotation only when a password was typed), and the
 * explicit "Clear stored password" action.
 *
 * @module apps/web/src/features/mailer-settings/components
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { MailerSettingsView } from '../api/mailer-settings.types';
import { MailerSettingsDialog } from './mailer-settings-dialog';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

afterEach(cleanup);

const smtpView: MailerSettingsView = {
  transport: 'smtp',
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpSecure: true,
  fromAddress: 'orders@example.com',
  smtpPasswordConfigured: true,
  updatedAt: '2026-07-01T00:00:00.000Z',
  updatedBy: 'admin',
};

describe('MailerSettingsDialog', () => {
  it('prefills the non-secret fields and leaves the password blank', () => {
    renderWithProviders(<MailerSettingsDialog open view={smtpView} onClose={() => undefined} />);

    expect(screen.getByLabelText(/smtp host/i)).toHaveValue('smtp.example.com');
    expect(screen.getByLabelText(/smtp port/i)).toHaveValue('587');
    expect(screen.getByLabelText(/from address/i)).toHaveValue('orders@example.com');
    expect(screen.getByLabelText(/smtp password/i)).toHaveValue('');
    expect(screen.getByText(/Password configured\. Leave blank to keep it/)).toBeInTheDocument();
  });

  it('submits the update mutation with the current form values', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ mailerSettings: { update } });
    const onClose = vi.fn();

    renderWithProviders(
      <MailerSettingsDialog open view={smtpView} onClose={onClose} />,
      { apiClient },
    );

    fireEvent.change(screen.getByLabelText(/smtp host/i), {
      target: { value: 'smtp2.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({
        transport: 'smtp',
        smtpHost: 'smtp2.example.com',
        smtpPort: 587,
        smtpSecure: true,
        fromAddress: 'orders@example.com',
      });
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('rotates the password only when a new value was typed', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const setCredentials = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ mailerSettings: { update, setCredentials } });

    renderWithProviders(
      <MailerSettingsDialog open view={smtpView} onClose={() => undefined} />,
      { apiClient },
    );

    fireEvent.change(screen.getByLabelText(/smtp password/i), {
      target: { value: 'new-secret-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(setCredentials).toHaveBeenCalledWith({ password: 'new-secret-password' });
    });
  });

  it('does not rotate the password when the field is left blank', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const setCredentials = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ mailerSettings: { update, setCredentials } });

    renderWithProviders(
      <MailerSettingsDialog open view={smtpView} onClose={() => undefined} />,
      { apiClient },
    );

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(update).toHaveBeenCalled();
    });
    expect(setCredentials).not.toHaveBeenCalled();
  });

  it('clears the stored password when "Clear stored password" is clicked', async () => {
    const clearCredentials = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ mailerSettings: { clearCredentials } });

    renderWithProviders(
      <MailerSettingsDialog open view={smtpView} onClose={() => undefined} />,
      { apiClient },
    );

    fireEvent.click(screen.getByRole('button', { name: /clear stored password/i }));

    await waitFor(() => {
      expect(clearCredentials).toHaveBeenCalled();
    });
  });

  it('hides smtp fields and the password control when transport is console', () => {
    renderWithProviders(
      <MailerSettingsDialog
        open
        view={{ ...smtpView, transport: 'console' }}
        onClose={() => undefined}
      />,
    );

    expect(screen.queryByLabelText(/smtp host/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/smtp password/i)).not.toBeInTheDocument();
  });
});
