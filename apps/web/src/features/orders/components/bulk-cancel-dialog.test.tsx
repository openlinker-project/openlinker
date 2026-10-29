/**
 * `BulkCancelDialog` unit tests (#3619, mockup M3 `bulk`).
 *
 * The result is per row: a mixed answer (cancelled, correction proposed,
 * refused, failed) renders every row and never hides one behind another.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BulkCancelDialog } from './bulk-cancel-dialog';
import { ApiError } from '../../../shared/api/api-error';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { BulkCancelOrdersResult } from '../api/order-bulk-actions.types';

const IDS = ['o1', 'o2', 'o3', 'o4', 'o5'];

const MIXED: BulkCancelOrdersResult = {
  total: 5,
  cancelled: 1,
  pending: 1,
  correctionProposed: 1,
  refused: 1,
  failed: 1,
  results: [
    { orderId: 'o1', outcome: 'cancelled' },
    { orderId: 'o2', outcome: 'pending' },
    { orderId: 'o3', outcome: 'correction-proposed', correctionProposalChangeId: 'chg_1' },
    {
      orderId: 'o4',
      outcome: 'refused',
      code: 'ORDER_ALREADY_SHIPPED',
      reason: 'This order has already shipped.',
    },
    { orderId: 'o5', outcome: 'failed', reason: 'Unexpected error (correlationId: abc).' },
  ],
};

function renderDialog(bulkCancelOrders = vi.fn().mockResolvedValue(MIXED)) {
  const onOpenChange = vi.fn();
  const onComplete = vi.fn();
  const api = createMockApiClient({ orders: { bulkCancelOrders } });
  renderWithProviders(
    <BulkCancelDialog open onOpenChange={onOpenChange} orderIds={IDS} onComplete={onComplete} />,
    { apiClient: api },
  );
  return { bulkCancelOrders, onOpenChange, onComplete };
}

afterEach(cleanup);

describe('BulkCancelDialog (#3619)', () => {
  it('should send every id with the chosen reason and the acknowledgement when confirmed', async () => {
    const { bulkCancelOrders, onComplete } = renderDialog();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByTestId('orders-bulk-cancel-reason'), 'out-of-stock');
    await user.click(screen.getByTestId('orders-bulk-cancel-ack'));
    await user.click(screen.getByTestId('orders-bulk-cancel-submit'));

    await waitFor(() => {
      expect(bulkCancelOrders).toHaveBeenCalledWith({
        orderIds: IDS,
        reason: 'out-of-stock',
        note: undefined,
        acknowledgeAcceptedWork: true,
      });
    });
    await waitFor(() => { expect(onComplete).toHaveBeenCalled(); });
  });

  it('should not send the acknowledgement when its box is untouched', async () => {
    const { bulkCancelOrders } = renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('orders-bulk-cancel-submit'));

    await waitFor(() => { expect(bulkCancelOrders).toHaveBeenCalled(); });
    expect(bulkCancelOrders.mock.calls[0][0].acknowledgeAcceptedWork).toBeUndefined();
  });

  it('should require a note when the reason is other', async () => {
    const { bulkCancelOrders } = renderDialog();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByTestId('orders-bulk-cancel-reason'), 'other');
    await user.click(screen.getByTestId('orders-bulk-cancel-submit'));

    expect(await screen.findByText('Say what the other reason is')).toBeInTheDocument();
    expect(bulkCancelOrders).not.toHaveBeenCalled();
  });

  it('should render one row per order for a mixed result, with the server reason and code', async () => {
    renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('orders-bulk-cancel-submit'));

    const results = await screen.findByTestId('orders-bulk-cancel-results');
    expect(screen.getAllByTestId('orders-bulk-result-row')).toHaveLength(5);
    expect(results).toHaveTextContent('Cancelled');
    expect(results).toHaveTextContent('Waiting for the channel');
    expect(results).toHaveTextContent('Cancelled, correction to review');
    expect(results).toHaveTextContent('This order has already shipped. (ORDER_ALREADY_SHIPPED)');
    expect(results).toHaveTextContent('Unexpected error (correlationId: abc).');
    expect(screen.getByTestId('orders-bulk-cancel-correction-link')).toHaveAttribute('href', '/orders/o3');
    expect(screen.getByTestId('orders-bulk-cancel-summary')).toHaveTextContent('2 of 5 handled');
    expect(screen.getByTestId('orders-bulk-cancel-summary')).toHaveTextContent('1 waiting for the channel');
  });

  it('should show the request failure and no result rows when the whole call fails', async () => {
    const failing = vi.fn().mockRejectedValue(new ApiError('Forbidden', 403, { message: 'Forbidden' }));
    renderDialog(failing);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('orders-bulk-cancel-submit'));

    expect(await screen.findByTestId('orders-bulk-cancel-error')).toHaveTextContent('Forbidden');
    expect(screen.queryByTestId('orders-bulk-cancel-results')).toBeNull();
  });

  it('should say the result is unconfirmed and keep the selection when the request times out (B-25)', async () => {
    const failing = vi.fn().mockRejectedValue(new ApiError('Gateway Timeout', 504, {}));
    const { onComplete } = renderDialog(failing);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('orders-bulk-cancel-submit'));

    const alert = await screen.findByTestId('orders-bulk-cancel-unconfirmed');
    expect(alert).toHaveTextContent('We could not confirm the result.');
    expect(alert).toHaveTextContent('Some orders may have been cancelled');
    expect(screen.queryByTestId('orders-bulk-cancel-error')).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('should render warnings as plain notes on a cancelled row (B-24)', async () => {
    const withWarnings: BulkCancelOrdersResult = {
      total: 1,
      cancelled: 1,
      pending: 0,
      correctionProposed: 0,
      refused: 0,
      failed: 0,
      results: [
        {
          orderId: 'o1',
          outcome: 'cancelled',
          warnings: ['stock-restored-only:c1', 'destination-not-notified', 'correction-unavailable:no-snapshot'],
        },
      ],
    };
    renderDialog(vi.fn().mockResolvedValue(withWarnings));
    const user = userEvent.setup();

    await user.click(screen.getByTestId('orders-bulk-cancel-submit'));

    const results = await screen.findByTestId('orders-bulk-cancel-results');
    expect(results).toHaveTextContent('Stock was restored on one channel only.');
    expect(results).toHaveTextContent('destination shop was not told');
    expect(results).toHaveTextContent('No credit note could be drafted (no-snapshot).');
  });
});
