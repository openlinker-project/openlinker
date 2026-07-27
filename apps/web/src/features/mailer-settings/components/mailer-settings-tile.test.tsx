/**
 * Mailer Settings Tile — Tests
 *
 * Covers the tile's loading/error/success (console default + smtp-configured)
 * states. Rendered under an admin session throughout — non-admin visibility
 * is asserted at the page level in `settings-page.test.tsx`, since gating
 * lives there, not in this component.
 *
 * @module apps/web/src/features/mailer-settings/components
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { MailerSettingsView } from '../api/mailer-settings.types';
import { MailerSettingsTile } from './mailer-settings-tile';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

afterEach(cleanup);

const adminSessionAdapter = createAuthenticatedSessionAdapter();

const consoleView: MailerSettingsView = {
  transport: 'console',
  smtpHost: null,
  smtpPort: null,
  smtpSecure: false,
  fromAddress: null,
  smtpPasswordConfigured: false,
  updatedAt: null,
  updatedBy: null,
};

const smtpView: MailerSettingsView = {
  transport: 'smtp',
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpSecure: false,
  fromAddress: 'orders@example.com',
  smtpPasswordConfigured: true,
  updatedAt: '2026-07-01T00:00:00.000Z',
  updatedBy: 'admin',
};

describe('MailerSettingsTile', () => {
  it('shows a loading state while the settings query is in flight', async () => {
    const apiClient = createMockApiClient({
      mailerSettings: { get: vi.fn(() => new Promise<MailerSettingsView>(() => {})) },
    });
    renderWithProviders(<MailerSettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    // Query is gated on session readiness (isAdmin), which resolves
    // asynchronously — wait for it before asserting the loading state.
    expect(await screen.findByText('Loading mailer settings…')).toBeInTheDocument();
  });

  it('shows an error state when the settings query fails', async () => {
    const apiClient = createMockApiClient({
      mailerSettings: { get: vi.fn().mockRejectedValue(new Error('Network down')) },
    });
    renderWithProviders(<MailerSettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    expect(
      await screen.findByText(/Could not load mailer settings: Network down/),
    ).toBeInTheDocument();
  });

  it('shows the console default with no smtp fields', async () => {
    const apiClient = createMockApiClient({
      mailerSettings: { get: vi.fn().mockResolvedValue(consoleView) },
    });
    renderWithProviders(<MailerSettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    expect(await screen.findByText('Console')).toBeInTheDocument();
    expect(screen.queryByText('Host')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('shows the smtp host/port/from/password summary when configured', async () => {
    const apiClient = createMockApiClient({
      mailerSettings: { get: vi.fn().mockResolvedValue(smtpView) },
    });
    renderWithProviders(<MailerSettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    expect(await screen.findByText('SMTP')).toBeInTheDocument();
    expect(screen.getByText('smtp.example.com')).toBeInTheDocument();
    expect(screen.getByText('587')).toBeInTheDocument();
    expect(screen.getByText('orders@example.com')).toBeInTheDocument();
    expect(screen.getByText('Configured')).toBeInTheDocument();
  });

  it('opens the edit dialog when Edit is clicked', async () => {
    const apiClient = createMockApiClient({
      mailerSettings: { get: vi.fn().mockResolvedValue(smtpView) },
    });
    renderWithProviders(<MailerSettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    const editButton = await screen.findByRole('button', { name: 'Edit' });
    fireEvent.click(editButton);

    await waitFor(() => {
      expect(screen.getByText('Edit mailer settings')).toBeInTheDocument();
    });
  });
});
