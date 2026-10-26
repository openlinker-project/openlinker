/**
 * `BulkBuyerNoteReadDialog` unit tests (#3619, mockup M3 `bulk`).
 *
 * Only orders with an unread note are sent; the rest are reported as skipped.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BulkBuyerNoteReadDialog } from './bulk-buyer-note-read-dialog';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { OrderRecord } from '../api/orders.types';

function order(id: string, extra: Partial<OrderRecord>): OrderRecord {
  return {
    internalOrderId: id,
    sourceConnectionId: 'conn-1',
    orderSnapshot: {},
    syncStatus: [],
    recordStatus: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  } as unknown as OrderRecord;
}

const ORDERS = [
  order('unread', { hasBuyerNote: true, buyerNoteState: 'present', buyerNoteReadAt: null }),
  order('read', { hasBuyerNote: true, buyerNoteState: 'present', buyerNoteReadAt: '2026-01-02T00:00:00.000Z' }),
  order('none', { hasBuyerNote: false, buyerNoteState: 'none' }),
];

function renderDialog(orders: OrderRecord[], bulkMarkBuyerNoteRead = vi.fn()) {
  const api = createMockApiClient({ orders: { bulkMarkBuyerNoteRead } });
  renderWithProviders(
    <MemoryRouter>
      <BulkBuyerNoteReadDialog open onOpenChange={vi.fn()} orders={orders} />
    </MemoryRouter>,
    { apiClient: api },
  );
  return bulkMarkBuyerNoteRead;
}

afterEach(cleanup);

describe('BulkBuyerNoteReadDialog (#3619)', () => {
  it('should send only the orders with an unread note and report the rest as skipped', async () => {
    const call = renderDialog(
      ORDERS,
      vi.fn().mockResolvedValue({
        total: 1,
        marked: 1,
        alreadyRead: 0,
        noNote: 0,
        notFound: 0,
        failed: 0,
        results: [{ orderId: 'unread', outcome: 'marked' }],
      }),
    );
    const user = userEvent.setup();

    expect(screen.getByTestId('orders-bulk-read-plan')).toHaveTextContent('1 order has an unread message, 2 will be skipped.');
    await user.click(screen.getByTestId('orders-bulk-read-submit'));

    await waitFor(() => { expect(call).toHaveBeenCalledWith(['unread']); });
    const results = await screen.findByTestId('orders-bulk-read-results');
    expect(screen.getAllByTestId('orders-bulk-result-row')).toHaveLength(3);
    expect(results).toHaveTextContent('Marked read');
    expect(results).toHaveTextContent('Skipped: already read');
    expect(results).toHaveTextContent('Skipped: no buyer message');
    expect(screen.getByTestId('orders-bulk-read-summary')).toHaveTextContent('1 marked read · 2 skipped');
  });

  it('should disable the action when no selected order has an unread note', () => {
    renderDialog([ORDERS[1], ORDERS[2]]);

    expect(screen.getByTestId('orders-bulk-read-nothing')).toBeInTheDocument();
    expect(screen.getByTestId('orders-bulk-read-submit')).toBeDisabled();
  });

  it('should surface a backend per-row failure beside the skipped rows', async () => {
    renderDialog(
      [ORDERS[0]],
      vi.fn().mockResolvedValue({
        total: 1,
        marked: 0,
        alreadyRead: 0,
        noNote: 0,
        notFound: 0,
        failed: 1,
        results: [{ orderId: 'unread', outcome: 'failed', reason: 'Unexpected error (correlationId: z).' }],
      }),
    );
    const user = userEvent.setup();

    await user.click(screen.getByTestId('orders-bulk-read-submit'));

    expect(await screen.findByTestId('orders-bulk-read-results')).toHaveTextContent('Unexpected error (correlationId: z).');
  });
});
