/**
 * `CancelOrderDialog` unit tests (#3541, mockup M1).
 *
 * One test per rendered path: the confirmed cancel, the pending (202) progress
 * view, each refusal layout, and the soft gate. Refusals are produced as the
 * real client produces them - an `ApiError` whose body carries a machine code and
 * the server's sentence - and asserted on that sentence, because the point is
 * that the operator reads the server's reason rather than a generic error.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CancelOrderDialog, type CancelOrderDialogProps } from './cancel-order-dialog';
import { ApiError } from '../../../shared/api/api-error';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { CancelOrderResult } from '../api/order-cancel.types';

const ORDER_ID = 'ol_order_1';

function result(overrides: Partial<CancelOrderResult> = {}): CancelOrderResult {
  return {
    status: 'cancelled',
    changeId: 'change_1',
    cancelledAt: '2026-09-25T11:02:00.000Z',
    participants: [],
    otherParticipantsRelayFailed: false,
    voidedShipmentIds: [],
    cancelledWorkIds: [],
    stockRestoreEnqueued: true,
    correctionProposal: null,
    correctionUnavailableReason: null,
    ...overrides,
  };
}

function refusal(code: string, message: string, status = 409): ApiError {
  return new ApiError(message, status, { statusCode: status, error: code, message });
}

function renderDialog(
  cancelOrder = vi.fn().mockResolvedValue(result()),
  props: Partial<CancelOrderDialogProps> = {},
) {
  const onOpenChange = vi.fn();
  const onResult = vi.fn();
  const onGoToShipment = vi.fn();
  const api = createMockApiClient({
    orders: { cancelOrder },
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false }) },
  });

  renderWithProviders(
    <CancelOrderDialog
      open
      onOpenChange={onOpenChange}
      internalOrderId={ORDER_ID}
      orderNumber="ALG-24817"
      sourceName="Allegro"
      unitCount={6}
      totalLabel="348.99 PLN"
      invoiced={false}
      acceptedWork={false}
      onResult={onResult}
      onGoToShipment={onGoToShipment}
      {...props}
    />,
    { apiClient: api },
  );

  return { cancelOrder, onOpenChange, onResult, onGoToShipment };
}

afterEach(cleanup);

describe('CancelOrderDialog (#3541)', () => {
  it('should offer the closed reason set and send the chosen one', async () => {
    const { cancelOrder, onResult, onOpenChange } = renderDialog();
    const user = userEvent.setup();

    const select = await screen.findByLabelText('Reason');
    const labels = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(labels).toEqual(['buyer-request', 'out-of-stock', 'fraud', 'duplicate', 'other']);

    await user.selectOptions(select, 'out-of-stock');
    await user.click(screen.getByTestId('order-cancel-submit'));

    await waitFor(() => {
      expect(cancelOrder).toHaveBeenCalledWith(ORDER_ID, {
        reason: 'out-of-stock',
        note: undefined,
        acknowledgeAcceptedWork: undefined,
      });
    });
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }), 'out-of-stock');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('should require a note for the "other" reason before submitting', async () => {
    const { cancelOrder } = renderDialog();
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText('Reason'), 'other');
    await user.click(screen.getByTestId('order-cancel-submit'));

    expect(await screen.findByText('Say what the other reason is')).toBeInTheDocument();
    expect(cancelOrder).not.toHaveBeenCalled();

    await user.type(screen.getByTestId('order-cancel-note'), '  Buyer moved abroad  ');
    await user.click(screen.getByTestId('order-cancel-submit'));

    await waitFor(() => {
      expect(cancelOrder).toHaveBeenCalledWith(
        ORDER_ID,
        expect.objectContaining({ reason: 'other', note: 'Buyer moved abroad' }),
      );
    });
  });

  it('should say an invoiced order opens a correction proposal, and omit that row otherwise', async () => {
    const first = renderDialog(undefined, { invoiced: true });
    expect(await screen.findByTestId('order-cancel-impact-invoice')).toHaveTextContent(
      /correction proposal/i,
    );
    expect(first.cancelOrder).not.toHaveBeenCalled();
    cleanup();

    renderDialog(undefined, { invoiced: false });
    await screen.findByTestId('order-cancel-impact');
    expect(screen.queryByTestId('order-cancel-impact-invoice')).not.toBeInTheDocument();
  });

  it('should keep Paid in the money row rather than promising a refund', async () => {
    renderDialog();
    expect(await screen.findByTestId('order-cancel-impact-money')).toHaveTextContent(
      /keeps reading Paid until a refund is confirmed/,
    );
  });

  it('should show the progress view and keep the dialog open when the channel has not answered', async () => {
    const cancelOrder = vi.fn().mockResolvedValue(result({ status: 'pending', cancelledAt: null }));
    const { onOpenChange, onResult } = renderDialog(cancelOrder);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('order-cancel-submit'));

    expect(await screen.findByTestId('order-cancel-progress')).toBeInTheDocument();
    expect(screen.getByText('Waiting for Allegro')).toBeInTheDocument();
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }), 'buyer-request');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('should render the carrier reason and a Go to shipment path when a label cannot be voided', async () => {
    const reason = 'InPost cannot void label 6300123: the parcel is already scanned.';
    const cancelOrder = vi.fn().mockRejectedValue(refusal('LABEL_NOT_VOIDABLE', reason));
    const { onGoToShipment, onOpenChange } = renderDialog(cancelOrder);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('order-cancel-submit'));

    expect(await screen.findByTestId('order-cancel-label-refusal')).toHaveTextContent(reason);
    expect(screen.getByText('Cancel the shipment first')).toBeInTheDocument();

    await user.click(screen.getByTestId('order-cancel-label-go-to-shipment'));
    expect(onGoToShipment).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('should render the shipped refusal with the server reason and the returns pointer', async () => {
    const reason = 'The parcel was handed to InPost at 14:32.';
    const cancelOrder = vi.fn().mockRejectedValue(refusal('ORDER_ALREADY_SHIPPED', reason));
    renderDialog(cancelOrder);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('order-cancel-submit'));

    expect(await screen.findByTestId('order-cancel-shipped-refusal')).toHaveTextContent(reason);
    expect(screen.getByText(/Ask the buyer to refuse the parcel/)).toBeInTheDocument();
    expect(screen.queryByTestId('order-cancel-submit')).not.toBeInTheDocument();
  });

  it.each([
    ['ORDER_HAS_FISCAL_RECEIPT', 'A fiscal receipt was registered for this order.', 'A fiscal receipt blocks the cancel'],
    ['INVOICE_NOT_SETTLED', 'The invoice has not finished issuing.', 'The invoice has not finished issuing'],
    ['ORDER_ALREADY_CANCELLED', 'Order is already cancelled.', 'This order is already cancelled'],
    ['CHANNEL_REFUSED_CANCEL', 'Allegro refused: the order is paid out.', 'The sales channel refused the cancellation'],
  ])('should render the server reason for %s on the form', async (code, message, title) => {
    renderDialog(vi.fn().mockRejectedValue(refusal(code, message)));
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('order-cancel-submit'));

    const error = await screen.findByTestId('order-cancel-error');
    expect(error).toHaveTextContent(message);
    expect(error).toHaveTextContent(title);
    // The form stays, so the operator can read the reason next to what they sent.
    expect(screen.getByTestId('order-cancel-submit')).toBeInTheDocument();
  });

  it('should disable Cancel order until the pack-bench box is ticked when work is already accepted', async () => {
    const { cancelOrder } = renderDialog(undefined, { acceptedWork: true });
    const user = userEvent.setup();

    const submit = await screen.findByTestId('order-cancel-submit');
    expect(submit).toBeDisabled();

    await user.click(screen.getByTestId('order-cancel-ack'));
    expect(submit).toBeEnabled();

    await user.click(submit);
    await waitFor(() => {
      expect(cancelOrder).toHaveBeenCalledWith(
        ORDER_ID,
        expect.objectContaining({ acknowledgeAcceptedWork: true }),
      );
    });
  });

  it('should reveal the acknowledgement after the server asks for it and resubmit with it', async () => {
    const cancelOrder = vi
      .fn()
      .mockRejectedValueOnce(
        refusal('ORDER_WORK_ACCEPTED_NEEDS_ACK', 'A packer already claimed this order.'),
      )
      .mockResolvedValueOnce(result());
    const { onResult } = renderDialog(cancelOrder);
    const user = userEvent.setup();

    expect(screen.queryByTestId('order-cancel-ack')).not.toBeInTheDocument();
    await user.click(await screen.findByTestId('order-cancel-submit'));

    expect(await screen.findByTestId('order-cancel-error')).toHaveTextContent(
      'A packer already claimed this order.',
    );
    const submit = screen.getByTestId('order-cancel-submit');
    expect(submit).toBeDisabled();

    await user.click(screen.getByTestId('order-cancel-ack'));
    await user.click(submit);

    await waitFor(() => {
      expect(cancelOrder).toHaveBeenLastCalledWith(
        ORDER_ID,
        expect.objectContaining({ acknowledgeAcceptedWork: true }),
      );
    });
    await waitFor(() => {
      expect(onResult).toHaveBeenCalled();
    });
  });
});
