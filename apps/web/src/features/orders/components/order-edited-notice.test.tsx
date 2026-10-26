/**
 * `OrderEditedNotice` unit tests (#3544, mockup M1 `edit-saved`).
 *
 * The banner states both figures, lists what the edit left for the operator
 * (confirm the refund the seller makes on the channel, review a correction) from
 * the server's open proposals, and gates the two actions on admin.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderEditedNotice, type OrderEditedNoticeProps } from './order-edited-notice';
import { ApiError } from '../../../shared/api/api-error';
import type { SessionUser } from '../../../shared/auth/session.types';
import type { OrderDiscountResult, OrderEditsView } from '../api/order-edit.types';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';

const ORDER_ID = 'ol_order_1';

const ADMIN: SessionUser = {
  id: 'user_1',
  username: 'admin',
  email: 'admin@example.com',
  role: 'admin',
  permissions: ['orders:read', 'orders:write'],
};
const VIEWER: SessionUser = {
  ...ADMIN,
  id: 'user_3',
  username: 'viewer',
  role: 'viewer',
  permissions: ['orders:read'],
};

function edits(overrides: Partial<OrderEditsView> = {}): OrderEditsView {
  return {
    editedAt: '2026-09-25T09:41:00.000Z',
    address: null,
    lines: [{ orderLineId: 'line_a', channelQuantity: 3, quantity: 2 }],
    deliveryMethod: null,
    totals: { currency: 'PLN', channelTotal: 348.99, total: 294.99, difference: 54, taxRestated: false },
    discount: null,
    discountProposals: [],
    cod: null,
    history: [],
    ...overrides,
  };
}

const refundProposal = {
  changeId: 'change_refund',
  kind: 'order.discount_refund' as const,
  status: 'requested',
  requestedAt: '2026-09-25T09:41:00.000Z',
  currency: 'PLN',
  amount: '15.00',
  invoiceRecordId: null,
  documentNumber: null,
  lines: null,
};
const correctionProposal = {
  changeId: 'change_correction',
  kind: 'order.discount_correction' as const,
  status: 'requested',
  requestedAt: '2026-09-25T09:41:00.000Z',
  currency: 'PLN',
  amount: null,
  invoiceRecordId: 'inv_1',
  documentNumber: 'FV/412/09/2026',
  lines: [
    { originalLineNumber: 1, name: 'Kubek', previousUnitPriceGross: 39, newUnitPriceGross: 36 },
  ],
};

function renderNotice(
  props: Partial<OrderEditedNoticeProps> = {},
  confirmOrderChange = vi.fn().mockResolvedValue({
    changeId: 'change_refund',
    kind: 'order.discount_refund',
    status: 'confirmed',
    invoiceRecordId: null,
    invoiceStatus: null,
    documentNumber: null,
    refundRecordId: 'refund_1',
  }),
  user: SessionUser = ADMIN,
) {
  const onConfirmed = vi.fn();
  const api = createMockApiClient({
    orders: { confirmOrderChange },
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false }) },
  });
  renderWithProviders(
    <OrderEditedNotice
      internalOrderId={ORDER_ID}
      edits={edits()}
      sourceName="Allegro"
      onConfirmed={onConfirmed}
      {...props}
    />,
    { apiClient: api, sessionAdapter: createAuthenticatedSessionAdapter(user) },
  );
  return { confirmOrderChange, onConfirmed };
}

afterEach(cleanup);

describe('OrderEditedNotice (#3544)', () => {
  it('should render nothing for an order nobody edited', () => {
    renderNotice({ edits: null });
    expect(screen.queryByTestId('order-edit-notice')).not.toBeInTheDocument();
  });

  it('should say the channel keeps the original and show both figures', async () => {
    renderNotice();
    const notice = await screen.findByTestId('order-edit-notice');
    expect(notice).toHaveTextContent('This order was edited in OpenLinker');
    expect(notice).toHaveTextContent(/Allegro still shows the order as the buyer placed it/);
    expect(notice).toHaveTextContent(/348[.,]99/);
    expect(notice).toHaveTextContent(/294[.,]99/);
    expect(notice).toHaveTextContent(/one line you lowered here/);
  });

  it('should show the cash-on-delivery amount beside the channel one', async () => {
    renderNotice({ edits: edits({ cod: { channelAmount: '348.99', amount: '294.99', currency: 'PLN' } }) });
    expect(await screen.findByTestId('order-edit-cod')).toHaveTextContent(
      'collect 294.99 PLN (Allegro has 348.99 PLN)',
    );
  });

  it('should offer to confirm the refund on the channel, and record it', async () => {
    const { confirmOrderChange, onConfirmed } = renderNotice({
      edits: edits({ discountProposals: [refundProposal] }),
    });
    const user = userEvent.setup();

    expect(await screen.findByTestId('order-edit-refund-pending')).toHaveTextContent(
      'Refund 15.00 PLN on Allegro, then confirm the refund here.',
    );
    await user.click(screen.getByTestId('order-edit-confirm-refund'));
    expect(await screen.findByTestId('order-edit-refund-dialog')).toHaveTextContent(
      /doesn’t move money/,
    );
    await user.click(screen.getByTestId('order-edit-refund-confirm'));

    await waitFor(() => {
      expect(confirmOrderChange).toHaveBeenCalledWith(ORDER_ID, 'change_refund');
    });
    expect(onConfirmed).toHaveBeenCalledWith(expect.objectContaining({ refundRecordId: 'refund_1' }));
  });

  it('should show the ceiling figures and resend only once acknowledged', async () => {
    const confirmOrderChange = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError('over the ceiling', 409, {
          statusCode: 409,
          error: 'Conflict',
          code: 'refund_ceiling_exceeded',
          message: 'over the ceiling',
          ceiling: '10.00',
          alreadyRefunded: '339.00',
          requested: '15.00',
          currency: 'PLN',
        }),
      )
      .mockResolvedValue({
        changeId: 'change_refund',
        kind: 'order.discount_refund',
        status: 'confirmed',
        invoiceRecordId: null,
        invoiceStatus: null,
        documentNumber: null,
        refundRecordId: 'refund_1',
      });
    renderNotice({ edits: edits({ discountProposals: [refundProposal] }) }, confirmOrderChange);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('order-edit-confirm-refund'));
    await user.click(await screen.findByTestId('order-edit-refund-confirm'));

    const ceiling = await screen.findByTestId('order-edit-refund-ceiling');
    expect(ceiling).toHaveTextContent('only 10.00 PLN');
    expect(screen.getByTestId('order-edit-refund-confirm')).toBeDisabled();

    await user.click(screen.getByTestId('order-edit-refund-ack'));
    await user.click(screen.getByTestId('order-edit-refund-confirm'));

    await waitFor(() => {
      expect(confirmOrderChange).toHaveBeenLastCalledWith(ORDER_ID, 'change_refund', {
        acknowledgeAboveCeiling: true,
      });
    });
  });

  it('should review the discount correction with the persisted repriced lines, after a reload too', async () => {
    // No session discount response: everything shown comes from the server's open proposal.
    renderNotice({ edits: edits({ discountProposals: [correctionProposal] }) });
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('order-edit-review-correction'));

    const dialog = await screen.findByTestId('order-edit-correction-dialog');
    expect(dialog).toHaveTextContent('FV/412/09/2026');
    expect(screen.getByTestId('order-correction-lines')).toHaveTextContent('36.00');
    expect(screen.queryByTestId('order-correction-lines-unavailable')).not.toBeInTheDocument();
  });

  it('should explain a correction that could not be drafted, and a refund that could not be opened', async () => {
    renderNotice({
      sessionDiscount: {
        correctionProposal: null,
        correctionUnavailableReason: 'not-fully-issued',
        refundIntentFailed: true,
      } as unknown as OrderDiscountResult,
    });

    expect(await screen.findByTestId('order-edit-correction-unavailable')).toHaveTextContent(
      /has not finished issuing/,
    );
    expect(screen.getByTestId('order-edit-refund-intent-failed')).toBeInTheDocument();
  });

  it('should show the banner to a viewer but not the confirm actions', async () => {
    renderNotice(
      { edits: edits({ discountProposals: [refundProposal, correctionProposal] }) },
      undefined,
      VIEWER,
    );

    expect(await screen.findByTestId('order-edit-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('order-edit-confirm-refund')).not.toBeInTheDocument();
    expect(screen.queryByTestId('order-edit-review-correction')).not.toBeInTheDocument();
  });
});
