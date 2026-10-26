/**
 * `OrderCancelResultNotice` unit tests (#3541, mockup M1 `cancel-progress` and
 * `cancel-done`).
 *
 * The honesty rules are what is asserted: payment stays Paid, no refund is
 * claimed, a participant that only restored stock (Erli) is named as such, and
 * a correction is never issued without the operator's confirm.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderCancelResultNotice } from './order-cancel-result-notice';
import { ApiError } from '../../../shared/api/api-error';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { CancelOrderResult, OrderChangeView } from '../api/order-cancel.types';

const ORDER_ID = 'ol_order_1';

function cancelRequest(overrides: Partial<OrderChangeView> = {}): OrderChangeView {
  return {
    id: 'change_cancel',
    kind: 'order.cancel_request',
    status: 'confirmed',
    open: false,
    requestedAt: '2026-09-25T11:02:00.000Z',
    confirmedAt: '2026-09-25T11:03:00.000Z',
    declinedReason: null,
    payload: { cancelRequest: { reason: 'buyer-request', note: null }, correction: null },
    ...overrides,
  };
}

function correction(overrides: Partial<OrderChangeView> = {}): OrderChangeView {
  return {
    id: 'change_1',
    kind: 'order.cancel_correction',
    status: 'requested',
    open: true,
    requestedAt: '2026-09-25T11:03:00.000Z',
    confirmedAt: null,
    declinedReason: null,
    payload: {
      cancelRequest: null,
      correction: {
        invoiceRecordId: 'inv_1',
        documentNumber: 'FV/412/09/2026',
        currency: 'PLN',
        lines: [
          { originalLineNumber: 1, name: 'Kubek ceramiczny', previousQuantity: 3, newQuantity: 0 },
          { originalLineNumber: 2, name: 'Talerz obiadowy', previousQuantity: 2, newQuantity: 0 },
        ],
      },
    },
    ...overrides,
  };
}

function session(overrides: Partial<CancelOrderResult> = {}): CancelOrderResult {
  return {
    status: 'cancelled',
    changeId: 'change_cancel',
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

function renderNotice(
  props: {
    changes: OrderChangeView[];
    refundRecorded?: boolean;
    sessionResult?: CancelOrderResult | null;
  },
  confirmOrderChange = vi.fn().mockResolvedValue({
    changeId: 'change_1',
    kind: 'order.cancel_correction',
    status: 'confirmed',
    invoiceRecordId: 'inv_2',
    invoiceStatus: 'issued',
    documentNumber: 'KOR/1/09/2026',
  }),
) {
  const onCorrectionConfirmed = vi.fn();
  const api = createMockApiClient({
    orders: { confirmOrderChange },
    connections: { getById: vi.fn().mockResolvedValue({ id: 'c1', name: 'Erli shop' }) },
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false }) },
  });
  renderWithProviders(
    <OrderCancelResultNotice
      internalOrderId={ORDER_ID}
      changes={props.changes}
      refundRecorded={props.refundRecorded ?? false}
      sourceName="Allegro"
      totalLabel="348.99 PLN"
      sessionResult={props.sessionResult ?? null}
      onCorrectionConfirmed={onCorrectionConfirmed}
    />,
    { apiClient: api },
  );
  return { confirmOrderChange, onCorrectionConfirmed };
}

afterEach(cleanup);

describe('OrderCancelResultNotice (#3541)', () => {
  it('should show a pending banner from the SERVER record when the channel has not answered', () => {
    renderNotice({ changes: [cancelRequest({ status: 'requested', open: true, confirmedAt: null })] });

    expect(screen.getByTestId('order-cancel-pending')).toHaveTextContent('waiting for Allegro');
    expect(screen.queryByTestId('order-cancel-done')).not.toBeInTheDocument();
  });

  it('should render nothing for an order with no cancel request', () => {
    renderNotice({ changes: [] });
    expect(screen.queryByTestId('order-cancel-done')).not.toBeInTheDocument();
    expect(screen.queryByTestId('order-cancel-pending')).not.toBeInTheDocument();
  });

  it('should tell the operator the refund is theirs, point at Confirm refund and keep Paid', () => {
    renderNotice({ changes: [cancelRequest()] });

    const refund = screen.getByTestId('order-cancel-done-refund');
    expect(refund).toHaveTextContent('Refund 348.99 PLN to the buyer yourself');
    expect(refund).toHaveTextContent('keeps reading Paid');
    expect(refund).toHaveTextContent('Confirm refund');
    expect(screen.getByTestId('order-cancel-done')).toHaveTextContent('1 thing is left for you');
  });

  it('should stop asking for a refund once one is recorded, and disappear when nothing is left', () => {
    renderNotice({ changes: [cancelRequest()], refundRecorded: true });

    expect(screen.queryByTestId('order-cancel-done')).not.toBeInTheDocument();
  });

  it('should state that only stock was restored for a channel with no confirmed cancel call', async () => {
    renderNotice({
      changes: [cancelRequest()],
      sessionResult: session({
        participants: [
          { connectionId: 'c1', role: 'source', effect: 'stock-restored-only', detail: null },
        ],
      }),
    });

    const participants = await screen.findByTestId('order-cancel-done-participants');
    expect(participants).toHaveTextContent('Stock restored only');
    expect(participants).toHaveTextContent(/no confirmed cancel call/);
  });

  it('should not list a participant that was simply notified', () => {
    renderNotice({
      changes: [cancelRequest()],
      sessionResult: session({
        participants: [{ connectionId: 'c1', role: 'source', effect: 'notified', detail: null }],
      }),
    });

    expect(screen.queryByTestId('order-cancel-done-participants')).not.toBeInTheDocument();
  });

  it('should explain why no correction was drafted when the session knows', () => {
    renderNotice({
      changes: [cancelRequest()],
      sessionResult: session({ correctionUnavailableReason: 'no-line-snapshot' }),
    });

    expect(screen.getByTestId('order-cancel-done-correction-unavailable')).toHaveTextContent(
      /no record of the lines on the original invoice/,
    );
  });

  it('should offer the correction from the server record after a reload, with no session result', async () => {
    const { confirmOrderChange, onCorrectionConfirmed } = renderNotice({
      changes: [correction(), cancelRequest()],
      sessionResult: null,
    });
    const user = userEvent.setup();

    expect(screen.getByTestId('order-cancel-done-correction')).toHaveTextContent('FV/412/09/2026');
    expect(confirmOrderChange).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('order-cancel-review-correction'));
    const lines = await screen.findByTestId('order-correction-lines');
    expect(lines).toHaveTextContent('Kubek ceramiczny');
    expect(lines).toHaveTextContent('Talerz obiadowy');

    await user.click(screen.getByTestId('order-correction-confirm'));

    await waitFor(() => {
      expect(confirmOrderChange).toHaveBeenCalledWith(ORDER_ID, 'change_1');
    });
    await waitFor(() => {
      expect(onCorrectionConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({ documentNumber: 'KOR/1/09/2026' }),
      );
    });
  });

  it('should not offer a correction that is already confirmed', () => {
    renderNotice({
      changes: [correction({ status: 'confirmed', open: false }), cancelRequest()],
    });

    expect(screen.queryByTestId('order-cancel-review-correction')).not.toBeInTheDocument();
    expect(screen.getByTestId('order-cancel-done-correction-confirmed')).toBeInTheDocument();
  });

  it('should keep the confirm button for a provider failure and show the provider reason', async () => {
    const message = 'KSeF rejected the correction: NIP missing.';
    const confirmOrderChange = vi
      .fn()
      .mockRejectedValue(
        new ApiError(message, 422, { statusCode: 422, error: 'CORRECTION_FAILED', message }),
      );
    renderNotice({ changes: [correction(), cancelRequest()] }, confirmOrderChange);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('order-cancel-review-correction'));
    await user.click(await screen.findByTestId('order-correction-confirm'));

    const error = await screen.findByTestId('order-correction-error');
    expect(error).toHaveTextContent(message);
    expect(error).toHaveTextContent('The invoicing provider rejected the correction');
    expect(screen.getByTestId('order-correction-confirm')).toBeEnabled();
  });

  it('should drop the confirm button when the proposal can never be confirmed again', async () => {
    const message = 'This correction proposal expired.';
    const confirmOrderChange = vi
      .fn()
      .mockRejectedValue(
        new ApiError(message, 409, { statusCode: 409, error: 'CHANGE_EXPIRED', message }),
      );
    renderNotice({ changes: [correction(), cancelRequest()] }, confirmOrderChange);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('order-cancel-review-correction'));
    await user.click(await screen.findByTestId('order-correction-confirm'));

    expect(await screen.findByTestId('order-correction-error')).toHaveTextContent(message);
    expect(screen.queryByTestId('order-correction-confirm')).not.toBeInTheDocument();
  });
});
