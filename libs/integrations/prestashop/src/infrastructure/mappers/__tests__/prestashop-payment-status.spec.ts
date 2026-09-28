/**
 * What a PrestaShop order state says about the money (#3365).
 *
 * `PrestashopOrderSourceAdapter` reported no payment status at all, and an
 * `auto-on-paid` connection reads exactly that field - so every PrestaShop sale
 * sat `waiting` for ever: no invoice, no receipt, no warehouse release and
 * therefore no stock movement, with nothing anywhere saying why. These cases
 * pin the rule that closed it, and the two places it refuses to infer.
 */
import { derivePaymentStatusFromState } from '../prestashop-order-state-semantics';
import type { PrestashopOrderState } from '../../../domain/types/prestashop-options.types';

function state(partial: Partial<PrestashopOrderState>): PrestashopOrderState {
  return {
    id: '2',
    name: 'Payment accepted',
    paid: '0',
    shipped: '0',
    delivered: '0',
    logable: '1',
    ...partial,
  } as PrestashopOrderState;
}

describe('derivePaymentStatusFromState', () => {
  it('reports paid when the shop sets its own paid flag', () => {
    expect(derivePaymentStatusFromState(state({ paid: '1' }))).toBe('paid');
  });

  it('reports awaiting when the flag is clear', () => {
    expect(derivePaymentStatusFromState(state({ paid: '0', name: 'Awaiting bank wire payment' }))).toBe(
      'awaiting',
    );
  });

  // PrestaShop leaves `paid` set on a refunded order - the money did arrive,
  // and then went back - so the refund label is tested first.
  it('reports refunded even though the paid flag is still set', () => {
    expect(derivePaymentStatusFromState(state({ paid: '1', name: 'Refunded' }))).toBe('refunded');
  });

  // A cash-on-delivery parcel ships and is delivered while still unpaid, so
  // payment is read from the paid flag alone and never from a shipment flag.
  it('does NOT infer payment from a shipped or delivered state', () => {
    expect(derivePaymentStatusFromState(state({ paid: '0', shipped: '1', name: 'Shipped' }))).toBe(
      'awaiting',
    );
    expect(
      derivePaymentStatusFromState(state({ paid: '0', delivered: '1', name: 'Delivered' })),
    ).toBe('awaiting');
  });

  // `ps_order_state` carries no COD flag; the payment method is free text on
  // the order, written by whichever module handled it. An unpaid COD order
  // reads awaiting, which is true.
  it('never reports cod', () => {
    const answers = [
      state({ paid: '0', name: 'Awaiting cash on delivery validation' }),
      state({ paid: '1', name: 'Payment accepted' }),
      state({ paid: '0', shipped: '1', name: 'Shipped' }),
    ].map(derivePaymentStatusFromState);
    expect(answers).not.toContain('cod');
  });

  it('reads the flag as truthy for both shapes PrestaShop returns', () => {
    expect(derivePaymentStatusFromState(state({ paid: '1' }))).toBe('paid');
    expect(derivePaymentStatusFromState(state({ paid: 'true' }))).toBe('paid');
  });
});
