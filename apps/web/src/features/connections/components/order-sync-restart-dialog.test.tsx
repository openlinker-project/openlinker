/**
 * OrderSyncRestartDialog tests (#4228)
 *
 * @module features/connections/components
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { ApiClient } from '../../../app/api/api-client';
import { OrderSyncRestartDialog } from './order-sync-restart-dialog';

const CONNECTION = {
  id: 'conn_1',
  platformType: 'prestashop',
  adapterKey: 'prestashop.webservice.v1',
};

type AdapterSummary = Awaited<ReturnType<ApiClient['adapters']['list']>>[number];
type AdapterList = () => Promise<AdapterSummary[]>;

function adapterList(extra: Partial<AdapterSummary> = {}): Mock<AdapterList> {
  return vi.fn<AdapterList>().mockResolvedValue([
    {
      adapterKey: 'prestashop.webservice.v1',
      platformType: 'prestashop',
      displayName: 'PrestaShop',
      version: '1.0.0',
      supportedCapabilities: ['OrderSource'],
      isDefault: true,
      orderSyncStartModes: ['now', 'from', 'all'],
      orderWindowImport: true,
      ...extra,
    },
  ]);
}

function renderDialog(
  connections: Record<string, unknown>,
  options: { hasFeedPosition?: boolean; adapters?: Mock<AdapterList> } = {}
): { onOpenChange: ReturnType<typeof vi.fn> } {
  const onOpenChange = vi.fn();
  const apiClient = createMockApiClient({
    connections,
    adapters: { list: options.adapters ?? adapterList() },
  });
  renderWithProviders(
    <OrderSyncRestartDialog
      connection={CONNECTION}
      open
      onOpenChange={onOpenChange}
      hasFeedPosition={options.hasFeedPosition}
    />,
    { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() }
  );
  return { onOpenChange };
}

afterEach(cleanup);

describe('OrderSyncRestartDialog', () => {
  it('confirms a changed start when the restart was applied', async () => {
    const user = userEvent.setup();
    const restartOrderSync = vi.fn().mockResolvedValue({ applied: true });
    renderDialog({ restartOrderSync });

    await user.click(await screen.findByRole('radio', { name: /Every order the shop has/ }));
    await user.click(screen.getByRole('button', { name: 'Apply change' }));

    await waitFor(() => expect(restartOrderSync).toHaveBeenCalledWith('conn_1', { mode: 'all' }));
    expect(await screen.findByText('Start changed')).toBeInTheDocument();
  });

  it('says there was nothing to reset when the restart was not applied', async () => {
    const user = userEvent.setup();
    const restartOrderSync = vi
      .fn()
      .mockResolvedValue({ applied: false, reason: 'already-following-feed' });
    renderDialog({ restartOrderSync });

    await user.click(await screen.findByRole('radio', { name: /Every order the shop has/ }));
    await user.click(screen.getByRole('button', { name: 'Apply change' }));

    expect(await screen.findByText('Nothing to reset')).toBeInTheDocument();
    expect(screen.queryByText('Start changed')).not.toBeInTheDocument();
  });

  it('disables Apply for "only new orders" when the connection already follows the feed', async () => {
    const restartOrderSync = vi.fn();
    renderDialog({ restartOrderSync }, { hasFeedPosition: true });

    expect(await screen.findByRole('button', { name: 'Apply change' })).toBeDisabled();
    expect(screen.getByText(/already reading orders from the shop/)).toBeInTheDocument();
    expect(restartOrderSync).not.toHaveBeenCalled();
  });

  it('shows the busy message when a restart collides with a running check', async () => {
    const user = userEvent.setup();
    const restartOrderSync = vi
      .fn()
      .mockRejectedValue(new ApiError('busy', 409, { code: 'ORDER_SYNC_BUSY' }));
    renderDialog({ restartOrderSync });

    await user.click(await screen.findByRole('radio', { name: /Every order the shop has/ }));
    await user.click(screen.getByRole('button', { name: 'Apply change' }));

    expect(await screen.findByText('Could not change the start')).toBeInTheDocument();
    expect(screen.getByText(/order poll of this connection is running/)).toBeInTheDocument();
  });

  it('is titled for changing the start', async () => {
    renderDialog({});
    expect(await screen.findByText('Change where syncing starts')).toBeInTheDocument();
    expect(screen.queryByText('Get orders from a period')).not.toBeInTheDocument();
  });
});
