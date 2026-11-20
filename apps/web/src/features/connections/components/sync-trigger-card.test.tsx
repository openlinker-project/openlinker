/**
 * SyncTriggerCard tests
 *
 * @module features/connections/components
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  createAuthenticatedSessionAdapter,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import { SyncTriggerCard } from './sync-trigger-card';

const captureDemoEvent = vi.fn();
vi.mock('../../demo', () => ({
  captureDemoEvent: (...args: unknown[]): unknown => captureDemoEvent(...args),
}));

// jsdom does not implement showModal/close - stub them on HTMLDialogElement
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

const adminSession = { sessionAdapter: createAuthenticatedSessionAdapter() };

describe('SyncTriggerCard', () => {
  beforeEach(() => captureDemoEvent.mockClear());
  afterEach(cleanup);

  it('should offer Trigger sync for an active connection and open the dialog', async () => {
    renderWithProviders(<SyncTriggerCard connection={sampleConnection} />, adminSession);

    fireEvent.click(await screen.findByRole('button', { name: /trigger sync/i }));

    expect(screen.getByRole('combobox', { name: /job type/i })).toBeInTheDocument();
    expect(captureDemoEvent).toHaveBeenCalledWith('demo_connection_sync_dialog_opened', {});
  });

  it('should offer it for every platform, not only PrestaShop', async () => {
    renderWithProviders(
      <SyncTriggerCard connection={{ ...sampleConnection, platformType: 'allegro' }} />,
      adminSession,
    );

    expect(await screen.findByRole('button', { name: /trigger sync/i })).toBeInTheDocument();
  });

  it('should render nothing for a disabled connection, which resolves no adapter', async () => {
    const { container } = renderWithProviders(
      <SyncTriggerCard connection={{ ...sampleConnection, status: 'disabled' }} />,
      adminSession,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('button', { name: /trigger sync/i })).not.toBeInTheDocument();
    expect(container.querySelector('.panel')).toBeNull();
  });

  describe('demo read-only viewer (#1615)', () => {
    const viewerSession = {
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'u2',
        username: 'viewer',
        email: null,
        role: 'viewer',
        permissions: ['connections:read', 'sync:read'],
      }),
    };
    const demoApi = (): ReturnType<typeof createMockApiClient> =>
      createMockApiClient({ system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) } });

    it('should open the dialog with an enabled job type select but a disabled Trigger submit', async () => {
      renderWithProviders(<SyncTriggerCard connection={sampleConnection} />, {
        apiClient: demoApi(),
        ...viewerSession,
      });

      fireEvent.click(await screen.findByRole('button', { name: /trigger sync/i }));

      expect(screen.getByRole('combobox', { name: /job type/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /^trigger$/i })).toBeDisabled();
    });

    it('should hide the card from a non-demo viewer without sync:write', async () => {
      renderWithProviders(<SyncTriggerCard connection={sampleConnection} />, viewerSession);

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByRole('button', { name: /trigger sync/i })).not.toBeInTheDocument();
    });
  });
});
