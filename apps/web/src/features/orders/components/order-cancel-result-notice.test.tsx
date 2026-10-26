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

const PROPOSAL = {
  changeId: 'change_1',
  invoiceRecordId: 'inv_1',
  documentNumber: 'FV/412/09/2026',
  currency: 'PLN',
  lines: [
    { originalLineNumber: 1, name: 'Kubek ceramiczny', previousQuantity: 3, newQuantity: 0 },
    { originalLineNumber: 2, name: 'Talerz obiadowy', previousQuantity: 2, newQuantity: 0 },
  ],
};

function renderNotice(
  value: CancelOrderResult,
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
      result={value}
      internalOrderId={ORDER_ID}
      sourceName="Allegro"
      totalLabel="348.99 PLN"
      onCorrectionConfirmed={onCorrectionConfirmed}
    />,
    { apiClient: api },
  );
  return { confirmOrderChange, onCorrectionConfirmed };
}

afterEach(cleanup);

describe('OrderCancelResultNotice (#3541)', () => {
  it('should show a pending banner naming the channel when it has not answered', () => {
    renderNotice(result({ status: 'pending', cancelledAt: null }));

    expect(screen.getByTestId('order-cancel-pending')).toHaveTextContent('waiting for Allegro');
    expect(screen.queryByTestId('order-cancel-done')).not.toBeInTheDocument();
  });

  it('should tell the operator the refund is theirs and the payment keeps reading Paid', () => {
    renderNotice(result());

    const refund = screen.getByTestId('order-cancel-done-refund');
    expect(refund).toHaveTextContent('Refund 348.99 PLN to the buyer yourself');
    expect(refund).toHaveTextContent('keeps reading Paid until a refund is confirmed');
    expect(screen.getByTestId('order-cancel-done')).toHaveTextContent('1 thing is left for you');
  });

  it('should state that only stock was restored for a channel with no confirmed cancel call', async () => {
    renderNotice(
      result({
        participants: [
          { connectionId: 'c1', role: 'source', effect: 'stock-restored-only', detail: null },
        ],
      }),
    );

    const participants = await screen.findByTestId('order-cancel-done-participants');
    expect(participants).toHaveTextContent('Stock restored only');
    expect(participants).toHaveTextContent(/no confirmed cancel call/);
  });

  it('should not list a participant that was simply notified', () => {
    renderNotice(
      result({
        participants: [{ connectionId: 'c1', role: 'source', effect: 'notified', detail: null }],
      }),
    );

    expect(screen.queryByTestId('order-cancel-done-participants')).not.toBeInTheDocument();
  });

  it('should explain why no correction was drafted for an invoiced order', () => {
    renderNotice(result({ correctionUnavailableReason: 'no-line-snapshot' }));

    expect(screen.getByTestId('order-cancel-done-correction-unavailable')).toHaveTextContent(
      /no record of the lines on the original invoice/,
    );
    expect(screen.getByTestId('order-cancel-done')).toHaveTextContent('2 things are left for you');
  });

  it('should list the lines going to zero and confirm the correction on request', async () => {
    const { confirmOrderChange, onCorrectionConfirmed } = renderNotice(
      result({ correctionProposal: PROPOSAL }),
    );
    const user = userEvent.setup();

    expect(screen.getByTestId('order-cancel-done-correction')).toHaveTextContent('FV/412/09/2026');
    // Nothing is sent until the operator asks.
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
    // The page moves on: the review action is gone and the line says it was confirmed.
    expect(await screen.findByTestId('order-cancel-done-correction')).toHaveTextContent(
      'was confirmed as KOR/1/09/2026',
    );
    expect(screen.queryByTestId('order-cancel-review-correction')).not.toBeInTheDocument();
  });

  it('should keep the confirm button for a provider failure and show the provider reason', async () => {
    const message = 'KSeF rejected the correction: NIP missing.';
    const confirmOrderChange = vi
      .fn()
      .mockRejectedValue(
        new ApiError(message, 422, { statusCode: 422, error: 'CORRECTION_FAILED', message }),
      );
    renderNotice(result({ correctionProposal: PROPOSAL }), confirmOrderChange);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('order-cancel-review-correction'));
    await user.click(await screen.findByTestId('order-correction-confirm'));

    const error = await screen.findByTestId('order-correction-error');
    expect(error).toHaveTextContent(message);
    expect(error).toHaveTextContent('The invoicing provider rejected the correction');
    // The proposal stays open on the server, so a retry is offered.
    expect(screen.getByTestId('order-correction-confirm')).toBeEnabled();
  });

  it('should drop the confirm button when the proposal can never be confirmed again', async () => {
    const message = 'This correction proposal expired.';
    const confirmOrderChange = vi
      .fn()
      .mockRejectedValue(
        new ApiError(message, 409, { statusCode: 409, error: 'CHANGE_EXPIRED', message }),
      );
    renderNotice(result({ correctionProposal: PROPOSAL }), confirmOrderChange);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('order-cancel-review-correction'));
    await user.click(await screen.findByTestId('order-correction-confirm'));

    expect(await screen.findByTestId('order-correction-error')).toHaveTextContent(message);
    expect(screen.queryByTestId('order-correction-confirm')).not.toBeInTheDocument();
  });
});
