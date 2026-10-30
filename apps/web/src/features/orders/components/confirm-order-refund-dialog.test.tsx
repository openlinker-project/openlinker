/**
 * `ConfirmOrderRefundDialog` unit tests (#3541, mockup M1 header action).
 *
 * The ceiling refusal is the point: a refund past the order total is refused
 * with its figures, and only an explicit "Record it anyway" resends with
 * `acknowledgeAboveCeiling: true`.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmOrderRefundDialog } from './confirm-order-refund-dialog';
import { ApiError } from '../../../shared/api/api-error';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';

const ORDER_ID = 'ol_order_1';

const RECORD = {
  id: 'ref_1',
  internalOrderId: ORDER_ID,
  amount: '348.99',
  currency: 'PLN',
  reason: 'other',
  note: null,
  recordedAt: '2026-09-26T09:00:00.000Z',
  createdAt: '2026-09-26T09:00:00.000Z',
};

function ceilingError(): ApiError {
  return new ApiError('Refunds would exceed the order total', 409, {
    statusCode: 409,
    error: 'Conflict',
    code: 'refund_ceiling_exceeded',
    message: 'Refunds would exceed the order total',
    ceiling: '348.99',
    alreadyRefunded: '300.00',
    requested: '100.00',
    currency: 'PLN',
  });
}

function renderDialog(recordRefund = vi.fn().mockResolvedValue(RECORD)) {
  const onOpenChange = vi.fn();
  const api = createMockApiClient({
    orders: { recordRefund },
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false }) },
  });
  renderWithProviders(
    <ConfirmOrderRefundDialog
      open
      onOpenChange={onOpenChange}
      internalOrderId={ORDER_ID}
      currency="PLN"
      orderTotal="348.99"
    />,
    { apiClient: api },
  );
  return { recordRefund, onOpenChange };
}

afterEach(cleanup);

describe('ConfirmOrderRefundDialog (#3541)', () => {
  it('should record the refund in the order currency with an idempotency key and close', async () => {
    const { recordRefund, onOpenChange } = renderDialog();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/Amount refunded/), '348.99');
    await user.click(screen.getByRole('button', { name: 'Confirm refund' }));

    await waitFor(() => {
      expect(recordRefund).toHaveBeenCalledWith(
        ORDER_ID,
        expect.objectContaining({
          amount: '348.99',
          currency: 'PLN',
          reason: 'withdrawal',
          acknowledgeAboveCeiling: undefined,
          idempotencyKey: expect.stringMatching(/^ui-refund-/),
        }),
      );
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('should refuse to start without an amount', async () => {
    const { recordRefund } = renderDialog();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Confirm refund' }));

    expect(recordRefund).not.toHaveBeenCalled();
  });

  it('should show the ceiling figures and resend with the acknowledgement only when ticked', async () => {
    const recordRefund = vi
      .fn()
      .mockRejectedValueOnce(ceilingError())
      .mockResolvedValueOnce(RECORD);
    const { onOpenChange } = renderDialog(recordRefund);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/Amount refunded/), '100.00');
    await user.click(screen.getByRole('button', { name: 'Confirm refund' }));

    const alert = await screen.findByTestId('order-refund-ceiling');
    expect(alert).toHaveTextContent('300.00 PLN');
    expect(alert).toHaveTextContent('100.00 PLN');
    expect(alert).toHaveTextContent('348.99 PLN');
    // First call carried no acknowledgement: an untouched box claims nothing.
    expect(recordRefund.mock.calls[0][1].acknowledgeAboveCeiling).toBeUndefined();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    await user.click(screen.getByTestId('order-refund-acknowledge'));
    await user.click(screen.getByRole('button', { name: 'Confirm refund' }));

    await waitFor(() => {
      expect(recordRefund).toHaveBeenCalledTimes(2);
    });
    expect(recordRefund.mock.calls[1][1]).toEqual(
      expect.objectContaining({ amount: '100.00', acknowledgeAboveCeiling: true }),
    );
    // The same key both times: the first attempt recorded nothing.
    expect(recordRefund.mock.calls[1][1].idempotencyKey).toBe(recordRefund.mock.calls[0][1].idempotencyKey);
  });

  it('should show the server reason for any other refusal', async () => {
    renderDialog(
      vi.fn().mockRejectedValue(new ApiError('A refund with this idempotencyKey already exists for this order', 409, {})),
    );
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/Amount refunded/), '10');
    await user.click(screen.getByRole('button', { name: 'Confirm refund' }));

    expect(
      await screen.findByText(/already exists for this order/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('order-refund-ceiling')).not.toBeInTheDocument();
  });
});
