/**
 * `BulkTagPopover` unit tests (#3532/#3533, mockup M3 `bulk`).
 *
 * Pins: each tag reports "N of M has it" computed from the SELECTED rows
 * already loaded (no extra read), clicking a tag calls the bulk-assign
 * mutation with every selected order id, and the result message reports
 * added vs already-tagged.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BulkTagPopover } from './bulk-tag-popover';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { OrderRecord } from '../api/orders.types';

const TAGS = [
  { id: 'tag-1', name: 'VIP', color: 'violet' as const, orderCount: 3, createdAt: '', updatedAt: '' },
];

function makeOrder(id: string, tagIds: string[]): OrderRecord {
  return {
    internalOrderId: id,
    sourceConnectionId: 'conn-1',
    orderSnapshot: {},
    syncStatus: [],
    recordStatus: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tagIds,
  } as unknown as OrderRecord;
}

afterEach(cleanup);

describe('BulkTagPopover (#3532/#3533)', () => {
  it('reports how many of the selected orders already carry each tag', async () => {
    const orders = { listTags: vi.fn().mockResolvedValue(TAGS) };
    const api = createMockApiClient({ orders });
    const selectedOrders = [makeOrder('ol_order_1', ['tag-1']), makeOrder('ol_order_2', [])];

    renderWithProviders(<BulkTagPopover selectedOrders={selectedOrders} />, { apiClient: api });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Tags' }));

    expect(await screen.findByText('1 of 2 has it')).toBeInTheDocument();
  });

  it('bulk-assigns the tag to every selected order and reports the result', async () => {
    const orders = {
      listTags: vi.fn().mockResolvedValue(TAGS),
      bulkAssignTag: vi.fn().mockResolvedValue({ tagId: 'tag-1', added: 1, alreadyTagged: 1 }),
    };
    const api = createMockApiClient({ orders });
    const selectedOrders = [makeOrder('ol_order_1', ['tag-1']), makeOrder('ol_order_2', [])];

    renderWithProviders(<BulkTagPopover selectedOrders={selectedOrders} />, { apiClient: api });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Tags' }));
    await user.click(await screen.findByText('VIP'));

    await waitFor(() => {
      expect(orders.bulkAssignTag).toHaveBeenCalledWith('tag-1', ['ol_order_1', 'ol_order_2']);
    });
    expect(await screen.findByText(/Added "VIP" to 1 order/)).toBeInTheDocument();
  });

  it('surfaces an error rather than silently failing', async () => {
    const orders = {
      listTags: vi.fn().mockResolvedValue(TAGS),
      bulkAssignTag: vi.fn().mockRejectedValue(new Error('Tag not found')),
    };
    const api = createMockApiClient({ orders });

    renderWithProviders(<BulkTagPopover selectedOrders={[makeOrder('ol_order_1', [])]} />, {
      apiClient: api,
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Tags' }));
    await user.click(await screen.findByText('VIP'));

    expect(await screen.findByText('Tag not found')).toBeInTheDocument();
  });
});
