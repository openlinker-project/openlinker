import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
  createAuthenticatedSessionAdapter,
} from '../../../test/test-utils';
import { ConnectionActionsPanel } from './ConnectionActionsPanel';

// jsdom does not implement showModal/close — stub them on HTMLDialogElement
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

const adminSession = { sessionAdapter: createAuthenticatedSessionAdapter() };

describe('ConnectionActionsPanel', () => {
  afterEach(cleanup);

  it('renders edit, trigger sync, and disable actions for an active connection', async () => {
    renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />, adminSession);

    // findByRole waits for the session to hydrate (canWrite starts false)
    expect(await screen.findByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /trigger sync/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument();
  });

  it('hides trigger sync and disable when connection is already disabled', async () => {
    const disabledConnection = { ...sampleConnection, status: 'disabled' as const };
    renderWithProviders(<ConnectionActionsPanel connection={disabledConnection} />, adminSession);

    expect(await screen.findByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /trigger sync/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disable' })).not.toBeInTheDocument();
  });

  it('links edit action to the correct URL', async () => {
    renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />, adminSession);

    const editLink = await screen.findByRole('link', { name: 'Edit' });
    expect(editLink).toHaveAttribute('href', `/connections/${sampleConnection.id}/edit`);
  });

  it('shows trigger sync button for non-prestashop connections too', async () => {
    const allegroConnection = { ...sampleConnection, platformType: 'allegro' };
    renderWithProviders(<ConnectionActionsPanel connection={allegroConnection} />, adminSession);

    expect(await screen.findByRole('button', { name: /trigger sync/i })).toBeInTheDocument();
  });

  it('renders the PrestaShop plugin\'s "Configure webhooks" action for prestashop connections', async () => {
    renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />, adminSession);
    expect(await screen.findByRole('button', { name: /configure webhooks/i })).toBeInTheDocument();
  });

  it('does not render the "Configure webhooks" action for non-prestashop connections', async () => {
    const allegroConnection = { ...sampleConnection, platformType: 'allegro' };
    renderWithProviders(<ConnectionActionsPanel connection={allegroConnection} />, adminSession);
    // Wait for session to hydrate, then confirm no webhook button
    await screen.findByRole('button', { name: /trigger sync/i });
    expect(screen.queryByRole('button', { name: /configure webhooks/i })).not.toBeInTheDocument();
  });

  it('renders no plugin-specific actions for an unregistered platformType', async () => {
    const unknownConnection = { ...sampleConnection, platformType: 'shopify' };
    renderWithProviders(<ConnectionActionsPanel connection={unknownConnection} />, adminSession);
    expect(await screen.findByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /configure webhooks/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /trigger sync/i })).toBeInTheDocument();
  });

  it('opens the TriggerSyncDialog when "Trigger sync…" is clicked', async () => {
    renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />, adminSession);

    fireEvent.click(await screen.findByRole('button', { name: /trigger sync/i }));

    // Dialog is now open — job type select should be visible
    expect(screen.getByRole('combobox', { name: /job type/i })).toBeInTheDocument();
  });

  describe('demo read-only viewer (#1615)', () => {
    const viewerSession = { sessionAdapter: createAuthenticatedSessionAdapter({
      id: 'u2',
      username: 'viewer',
      email: null,
      role: 'viewer',
      permissions: ['connections:read', 'sync:read'],
    }) };

    function demoApiClient() {
      return createMockApiClient({ system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) } });
    }

    it('renders every action visible-but-disabled instead of hiding them', async () => {
      renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />, {
        apiClient: demoApiClient(),
        ...viewerSession,
      });

      expect(await screen.findByRole('button', { name: 'Test connection' })).toBeDisabled();
      expect(screen.getByRole('link', { name: 'Edit' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /trigger sync/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: 'Disable' })).toBeDisabled();
      expect(screen.getByRole('button', { name: /configure webhooks/i })).toBeDisabled();
    });

    it('opens the TriggerSyncDialog with an enabled job type select but a disabled Trigger submit', async () => {
      renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />, {
        apiClient: demoApiClient(),
        ...viewerSession,
      });

      fireEvent.click(await screen.findByRole('button', { name: /trigger sync/i }));

      const jobTypeSelect = screen.getByRole('combobox', { name: /job type/i });
      expect(jobTypeSelect).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /^trigger$/i })).toBeDisabled();
    });

    it('keeps the existing hide-when-missing behaviour for an unauthorized non-demo viewer', async () => {
      renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />, viewerSession);

      // Wait for the session to hydrate before asserting absence.
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Test connection' })).not.toBeInTheDocument();
      });
      expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /trigger sync/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Disable' })).not.toBeInTheDocument();
    });
  });
});
