/**
 * `OrderEditDialog` unit tests (#3544, mockup M1 edit-form / edit-review / edit-blocked).
 *
 * One test per rendered path: validation while typing, the dry-run review for an
 * address, quantities and a discount (paid and unpaid), each refusal layout and
 * the save. Refusals are produced as the real client produces them - an
 * `ApiError` whose body carries a machine code and the server's sentence - and
 * asserted on that sentence, because the point is that the operator reads the
 * server's reason rather than a generic error.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderEditDialog, type OrderEditDialogProps } from './order-edit-dialog';
import { ApiError } from '../../../shared/api/api-error';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type {
  OrderDiscountResult,
  OrderEditResult,
  OrderEditsView,
} from '../api/order-edit.types';
import { parseOrderSnapshot } from '../api/order-snapshot.schema';

const ORDER_ID = 'ol_order_1';

const snapshot = parseOrderSnapshot({
  orderNumber: 'ALG-24817',
  items: [
    { id: 'line_a', name: 'Kubek ceramiczny', sku: 'KUB-350', quantity: 3, price: 39 },
    { id: 'line_b', name: 'Talerz obiadowy', sku: 'TAL-27', quantity: 2, price: 54 },
  ],
  totals: { subtotal: 225, tax: 0, shipping: 14.99, total: 348.99, currency: 'PLN' },
  shipping: { methodId: 'inpost_kurier', methodName: 'InPost Kurier' },
  shippingAddress: {
    firstName: 'Magdalena',
    lastName: 'Wisniewska',
    address1: 'ul. Dluga 12',
    city: 'Krakow',
    postalCode: '31-147',
    country: 'PL',
  },
});

function view(overrides: Partial<OrderEditsView> = {}): OrderEditsView {
  return {
    editedAt: '2026-09-25T09:41:00.000Z',
    address: null,
    lines: [],
    deliveryMethod: null,
    totals: null,
    discount: null,
    discountProposals: [],
    cod: null,
    history: [],
    ...overrides,
  };
}

function editResult(overrides: Partial<OrderEditResult> = {}): OrderEditResult {
  return { dryRun: true, changeId: null, view: view(), stock: [], ...overrides };
}

function discountResult(overrides: Partial<OrderDiscountResult> = {}): OrderDiscountResult {
  return {
    dryRun: true,
    changeId: null,
    discount: {
      amount: '15.00',
      currency: 'PLN',
      perLine: [],
      changeId: 'preview',
      editedAt: '2026-09-25T09:41:00.000Z',
      editedBy: null,
    },
    totals: { currency: 'PLN', channelTotal: 348.99, total: 333.99, difference: 15 },
    paymentBranch: 'paid',
    amountToCollect: null,
    refundIntent: {
      changeId: null,
      amount: '15.00',
      currency: 'PLN',
      ceiling: {
        status: 'within',
        ceiling: '348.99',
        alreadyRefunded: '0',
        requested: '15.00',
        currency: 'PLN',
      },
    },
    refundIntentFailed: false,
    correctionProposal: null,
    correctionUnavailableReason: null,
    view: view({
      totals: { currency: 'PLN', channelTotal: 348.99, total: 333.99, difference: 15, taxRestated: false },
    }),
    ...overrides,
  };
}

function refusal(code: string, message: string, status = 409, extra: object = {}): ApiError {
  return new ApiError(message, status, { statusCode: status, error: code, message, ...extra });
}

function renderDialog(
  orders: Record<string, ReturnType<typeof vi.fn>> = {},
  props: Partial<OrderEditDialogProps> = {},
) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  const onGoTo = vi.fn();
  const api = createMockApiClient({
    orders,
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false }) },
  });

  renderWithProviders(
    <OrderEditDialog
      open
      onOpenChange={onOpenChange}
      internalOrderId={ORDER_ID}
      orderNumber="ALG-24817"
      sourceName="Allegro"
      snapshot={snapshot}
      edits={null}
      predictedRefusal={null}
      acceptedWork={false}
      onSaved={onSaved}
      onGoTo={onGoTo}
      {...props}
    />,
    { apiClient: api },
  );

  return { onOpenChange, onSaved, onGoTo };
}

async function changeStreet(user: ReturnType<typeof userEvent.setup>, value = 'ul. Dluga 12/4') {
  const street = await screen.findByTestId('order-edit-street');
  await user.clear(street);
  await user.type(street, value);
}

async function setQuantity(
  user: ReturnType<typeof userEvent.setup>,
  index: number,
  value: string,
) {
  const input = (await screen.findAllByTestId('order-edit-line-quantity'))[index];
  await user.clear(input);
  await user.type(input, value);
}

afterEach(cleanup);

describe('OrderEditDialog form (#3544)', () => {
  it('should keep Review changes disabled until something differs', async () => {
    renderDialog();
    expect(await screen.findByTestId('order-edit-review-button')).toBeDisabled();

    const user = userEvent.setup();
    await changeStreet(user);

    expect(screen.getByTestId('order-edit-review-button')).toBeEnabled();
  });

  it('should refuse raising a quantity while typing, without calling the server', async () => {
    const editOrderLines = vi.fn();
    renderDialog({ editOrderLines });
    const user = userEvent.setup();

    await setQuantity(user, 0, '5');
    await user.click(screen.getByTestId('order-edit-review-button'));

    expect(await screen.findByText('Can only go down: at most 3')).toBeInTheDocument();
    expect(editOrderLines).not.toHaveBeenCalled();
  });

  it('should refuse lowering every line to zero', async () => {
    const editOrderLines = vi.fn();
    renderDialog({ editOrderLines });
    const user = userEvent.setup();

    await setQuantity(user, 0, '0');
    await setQuantity(user, 1, '0');
    await user.click(screen.getByTestId('order-edit-review-button'));

    expect(await screen.findByTestId('order-edit-lines-error')).toHaveTextContent(/at least one item/);
    expect(editOrderLines).not.toHaveBeenCalled();
  });

  it('should refuse a discount that is not a plain amount', async () => {
    const editOrderDiscount = vi.fn();
    renderDialog({ editOrderDiscount });
    const user = userEvent.setup();

    await user.type(await screen.findByTestId('order-edit-discount-amount'), 'abc');
    await user.click(screen.getByTestId('order-edit-review-button'));

    expect(await screen.findByText(/Enter a plain amount/)).toBeInTheDocument();
    expect(editOrderDiscount).not.toHaveBeenCalled();
  });
});

describe('OrderEditDialog review and save (#3544, D9)', () => {
  it('should dry-run the address, show both figures from the server, then save the same body', async () => {
    const editOrderAddress = vi
      .fn()
      .mockResolvedValueOnce(
        editResult({
          view: view({
            address: {
              original: {
                firstName: 'Magdalena',
                lastName: 'Wisniewska',
                address1: 'ul. Dluga 12',
                city: 'Krakow',
                postalCode: '31-147',
                country: 'PL',
              },
              current: {
                firstName: 'Magdalena',
                lastName: 'Wisniewska',
                address1: 'ul. Dluga 12/4',
                city: 'Krakow',
                postalCode: '31-147',
                country: 'PL',
              },
            },
          }),
        }),
      )
      .mockResolvedValueOnce(editResult({ dryRun: false, changeId: 'change_1' }));
    const { onSaved, onOpenChange } = renderDialog({ editOrderAddress });
    const user = userEvent.setup();

    await changeStreet(user);
    await user.click(screen.getByTestId('order-edit-review-button'));

    const diff = await screen.findByTestId('order-edit-diff-address');
    expect(diff).toHaveTextContent('ul. Dluga 12 · 31-147 Krakow');
    expect(diff).toHaveTextContent('ul. Dluga 12/4');
    expect(screen.getByText('Allegro has')).toBeInTheDocument();
    expect(screen.getByTestId('order-edit-impact')).toHaveTextContent(/Allegro[\s\S]*Not sent/);
    expect(editOrderAddress.mock.calls[0][1]).toMatchObject({ dryRun: true, address1: 'ul. Dluga 12/4' });

    await user.click(screen.getByTestId('order-edit-save'));

    await waitFor(() => {
      expect(editOrderAddress).toHaveBeenCalledTimes(2);
    });
    expect(editOrderAddress.mock.calls[1][1].dryRun).toBeUndefined();
    expect(onSaved).toHaveBeenCalledWith([expect.objectContaining({ changeId: 'change_1' })]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('should show the lowered quantity beside the channel quantity and both totals', async () => {
    const editOrderLines = vi.fn().mockResolvedValue(
      editResult({
        view: view({
          lines: [{ orderLineId: 'line_a', channelQuantity: 3, quantity: 2 }],
          totals: { currency: 'PLN', channelTotal: 348.99, total: 309.99, difference: 39, taxRestated: false },
        }),
      }),
    );
    renderDialog({ editOrderLines });
    const user = userEvent.setup();

    await setQuantity(user, 0, '2');
    await user.click(screen.getByTestId('order-edit-review-button'));

    const row = await screen.findByTestId('order-edit-diff-line');
    expect(row).toHaveTextContent('Kubek ceramiczny');
    expect(row).toHaveTextContent('3');
    expect(row).toHaveTextContent('2');
    const total = screen.getByTestId('order-edit-diff-total');
    expect(total).toHaveTextContent(/348[.,]99/);
    expect(total).toHaveTextContent(/309[.,]99/);
    // Only the lowered line goes out.
    expect(editOrderLines.mock.calls[0][1]).toMatchObject({
      dryRun: true,
      lines: [{ orderLineId: 'line_a', quantity: 2 }],
    });
  });

  it('should state the refund on the channel and the document correction for a discount on a paid order', async () => {
    const editOrderDiscount = vi.fn().mockResolvedValue(
      discountResult({
        correctionProposal: {
          changeId: null,
          invoiceRecordId: 'inv_1',
          documentNumber: 'FV/412/09/2026',
          currency: 'PLN',
          lines: [],
        },
      }),
    );
    renderDialog({ editOrderDiscount });
    const user = userEvent.setup();

    await user.type(await screen.findByTestId('order-edit-discount-amount'), '15.00');
    await user.click(screen.getByTestId('order-edit-review-button'));

    const money = await screen.findByTestId('order-edit-money');
    expect(money).toHaveTextContent('Refund 15.00 PLN on Allegro');
    expect(money).toHaveTextContent(/OpenLinker doesn’t move money/);
    expect(screen.getByTestId('order-edit-ceiling')).toHaveTextContent(/Within/);
    expect(screen.getByTestId('order-edit-correction')).toHaveTextContent(/FV\/412\/09\/2026/);
    expect(editOrderDiscount.mock.calls[0][1]).toEqual({ dryRun: true, amount: '15.00' });
  });

  it('should state the amount to collect for a discount on an unpaid or cash-on-delivery order', async () => {
    const editOrderDiscount = vi.fn().mockResolvedValue(
      discountResult({
        paymentBranch: 'cod',
        refundIntent: null,
        amountToCollect: { amount: '333.99', currency: 'PLN' },
      }),
    );
    renderDialog({ editOrderDiscount });
    const user = userEvent.setup();

    await user.type(await screen.findByTestId('order-edit-discount-amount'), '15');
    await user.click(screen.getByTestId('order-edit-review-button'));

    const money = await screen.findByTestId('order-edit-money');
    expect(money).toHaveTextContent('Amount to collect');
    expect(money).toHaveTextContent('333.99 PLN');
    expect(money).not.toHaveTextContent(/Refund/);
  });

  it('should explain why a paid-order correction could not be drafted', async () => {
    const editOrderDiscount = vi
      .fn()
      .mockResolvedValue(discountResult({ correctionUnavailableReason: 'fiscal-receipt' }));
    renderDialog({ editOrderDiscount });
    const user = userEvent.setup();

    await user.type(await screen.findByTestId('order-edit-discount-amount'), '15');
    await user.click(screen.getByTestId('order-edit-review-button'));

    expect(await screen.findByTestId('order-edit-correction')).toHaveTextContent(/fiscal receipt/);
  });

  it('should refuse to preview a discount filled in beside a quantity change, and save the quantities alone', async () => {
    const editOrderLines = vi
      .fn()
      .mockResolvedValueOnce(
        editResult({ view: view({ lines: [{ orderLineId: 'line_a', channelQuantity: 3, quantity: 2 }] }) }),
      )
      .mockResolvedValueOnce(editResult({ dryRun: false, changeId: 'change_lines' }));
    const editOrderDiscount = vi.fn();
    const { onSaved, onOpenChange } = renderDialog({ editOrderLines, editOrderDiscount });
    const user = userEvent.setup();

    await setQuantity(user, 0, '2');
    await user.type(await screen.findByTestId('order-edit-discount-amount'), '15');
    await user.click(screen.getByTestId('order-edit-review-button'));

    expect(await screen.findByTestId('order-edit-discount-deferred')).toHaveTextContent(
      'Save the quantity change first, then apply the discount.',
    );
    expect(screen.queryByTestId('order-edit-money')).not.toBeInTheDocument();
    expect(editOrderDiscount).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('order-edit-save'));

    expect(await screen.findByTestId('order-edit-quantities-saved')).toBeInTheDocument();
    expect(editOrderLines).toHaveBeenCalledTimes(2);
    expect(editOrderDiscount).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith([expect.objectContaining({ changeId: 'change_lines' })]);
    // The dialog stays open with the discount still filled in, ready for its own review.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByTestId('order-edit-discount-amount')).toHaveValue('15');
  });

  it('should go back to editing without saving', async () => {
    const editOrderAddress = vi.fn().mockResolvedValue(editResult());
    renderDialog({ editOrderAddress });
    const user = userEvent.setup();

    await changeStreet(user);
    await user.click(screen.getByTestId('order-edit-review-button'));
    await user.click(await screen.findByTestId('order-edit-back'));

    expect(await screen.findByTestId('order-edit-street')).toHaveValue('ul. Dluga 12/4');
    expect(editOrderAddress).toHaveBeenCalledTimes(1);
  });
});

describe('OrderEditDialog refusals (#3544, edit-blocked)', () => {
  it('should render the server reason and a Packing remedy for a packed order', async () => {
    const editOrderAddress = vi
      .fn()
      .mockRejectedValue(refusal('ORDER_PACKED', 'This order is already packed by akowalczyk.'));
    const { onGoTo, onOpenChange } = renderDialog({ editOrderAddress });
    const user = userEvent.setup();

    await changeStreet(user);
    await user.click(screen.getByTestId('order-edit-review-button'));

    const blocked = await screen.findByTestId('order-edit-blocked');
    expect(blocked).toHaveTextContent('This order is already packed by akowalczyk.');
    expect(screen.getByTestId('order-edit-blocked-steps')).toHaveTextContent(/Mark the order as not packed/);
    await user.click(screen.getByTestId('order-edit-blocked-remedy'));
    expect(onGoTo).toHaveBeenCalledWith('packing');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('should lock the items and point at Sales document when a document is issued', async () => {
    const editOrderLines = vi
      .fn()
      .mockRejectedValue(
        refusal('SALES_DOCUMENT_ISSUED', 'Invoice FV/412/09/2026 is issued for this order.'),
      );
    const { onGoTo } = renderDialog({ editOrderLines });
    const user = userEvent.setup();

    await setQuantity(user, 0, '2');
    await user.click(screen.getByTestId('order-edit-review-button'));

    expect(await screen.findByTestId('order-edit-blocked')).toHaveTextContent(
      'Invoice FV/412/09/2026 is issued for this order.',
    );
    const locked = screen.getByTestId('order-edit-locked-lines');
    expect(within(locked).getAllByTestId('order-edit-line-quantity')[0]).toBeDisabled();
    // The address is still editable.
    expect(screen.getByTestId('order-edit-street')).toBeEnabled();
    await user.click(screen.getByTestId('order-edit-blocked-remedy'));
    expect(onGoTo).toHaveBeenCalledWith('invoicing');
  });

  it('should lock the address and delivery for a bought label', async () => {
    const editOrderDeliveryMethod = vi
      .fn()
      .mockRejectedValue(refusal('LABEL_ALREADY_BOUGHT', 'A label was bought for this order.'));
    renderDialog({ editOrderDeliveryMethod });
    const user = userEvent.setup();

    const method = await screen.findByTestId('order-edit-method-id');
    await user.clear(method);
    await user.type(method, 'dpd');
    await user.click(screen.getByTestId('order-edit-review-button'));

    expect(await screen.findByTestId('order-edit-blocked')).toHaveTextContent(
      'A label was bought for this order.',
    );
    expect(screen.getByTestId('order-edit-locked-address')).toBeInTheDocument();
    expect(screen.getByTestId('order-edit-locked-delivery')).toBeInTheDocument();
    // Items stay editable, so the operator can still change what is allowed.
    expect(screen.getAllByTestId('order-edit-line-quantity')[0]).toBeEnabled();
  });

  it('should show a refusal the page predicted on open, with no call made', async () => {
    const editOrderAddress = vi.fn();
    renderDialog({ editOrderAddress }, { predictedRefusal: 'ORDER_PACKED' });

    expect(await screen.findByTestId('order-edit-blocked')).toHaveTextContent(/already packed/);
    expect(screen.getByTestId('order-edit-review-button')).toBeDisabled();
    expect(editOrderAddress).not.toHaveBeenCalled();
  });

  it('should show a typing refusal inline and keep the form editable', async () => {
    const editOrderLines = vi
      .fn()
      .mockRejectedValue(
        refusal('QUANTITY_BELOW_FULFILLED', 'Two units of this line already shipped.'),
      );
    renderDialog({ editOrderLines });
    const user = userEvent.setup();

    await setQuantity(user, 0, '0');
    await user.click(screen.getByTestId('order-edit-review-button'));

    expect(await screen.findByTestId('order-edit-error')).toHaveTextContent(
      'Two units of this line already shipped.',
    );
    expect(screen.queryByTestId('order-edit-blocked')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('order-edit-line-quantity')[0]).toBeEnabled();
  });

  it('should ask for the pack-bench acknowledgement and send it on the retry', async () => {
    const editOrderLines = vi
      .fn()
      .mockRejectedValueOnce(
        refusal('ORDER_WORK_ACCEPTED_NEEDS_ACK', 'Picking has started for this order.'),
      )
      .mockResolvedValue(editResult());
    renderDialog({ editOrderLines });
    const user = userEvent.setup();

    await setQuantity(user, 0, '2');
    await user.click(screen.getByTestId('order-edit-review-button'));
    await user.click(await screen.findByTestId('order-edit-ack'));
    await user.click(screen.getByTestId('order-edit-review-button'));

    await waitFor(() => {
      expect(editOrderLines).toHaveBeenCalledTimes(2);
    });
    expect(editOrderLines.mock.calls[0][1].acknowledgeAcceptedWork).toBeUndefined();
    expect(editOrderLines.mock.calls[1][1].acknowledgeAcceptedWork).toBe(true);
  });

  it('should render the refund ceiling figures and resend only once acknowledged, with the remainder not the ceiling (E-42)', async () => {
    const editOrderDiscount = vi
      .fn()
      .mockRejectedValueOnce(
        refusal('Conflict', 'The refund would pass the ceiling.', 409, {
          code: 'refund_ceiling_exceeded',
          ceiling: '349.00',
          alreadyRefunded: '339.00',
          requested: '15.00',
          currency: 'PLN',
        }),
      )
      .mockResolvedValue(discountResult());
    renderDialog({ editOrderDiscount });
    const user = userEvent.setup();

    await user.type(await screen.findByTestId('order-edit-discount-amount'), '15');
    await user.click(screen.getByTestId('order-edit-review-button'));

    const ceiling = await screen.findByTestId('order-edit-ceiling-refusal');
    expect(ceiling).toHaveTextContent('15.00 PLN');
    expect(ceiling).toHaveTextContent('only 10.00 PLN can still be refunded on this order (339.00 PLN already refunded)');
    expect(editOrderDiscount.mock.calls[0][1].acknowledgeAboveCeiling).toBeUndefined();

    await user.click(screen.getByTestId('order-edit-ceiling-ack'));
    await user.click(screen.getByTestId('order-edit-review-button'));

    await waitFor(() => {
      expect(editOrderDiscount.mock.calls[1][1].acknowledgeAboveCeiling).toBe(true);
    });
  });

  it('should say what was saved when a later section is refused, and not resend it', async () => {
    const editOrderAddress = vi
      .fn()
      .mockResolvedValueOnce(editResult())
      .mockResolvedValueOnce(editResult({ dryRun: false, changeId: 'change_a' }));
    const editOrderLines = vi
      .fn()
      .mockResolvedValueOnce(editResult())
      .mockRejectedValueOnce(refusal('SALES_DOCUMENT_ISSUED', 'An invoice was issued meanwhile.'));
    const { onSaved, onOpenChange } = renderDialog({ editOrderAddress, editOrderLines });
    const user = userEvent.setup();

    await changeStreet(user);
    await setQuantity(user, 0, '2');
    await user.click(screen.getByTestId('order-edit-review-button'));
    await user.click(await screen.findByTestId('order-edit-save'));

    expect(await screen.findByTestId('order-edit-blocked')).toHaveTextContent(
      'An invoice was issued meanwhile.',
    );
    expect(screen.getByTestId('order-edit-blocked-saved')).toHaveTextContent(
      'Already saved: shipping address.',
    );
    expect(onSaved).toHaveBeenCalledWith([expect.objectContaining({ changeId: 'change_a' })]);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
