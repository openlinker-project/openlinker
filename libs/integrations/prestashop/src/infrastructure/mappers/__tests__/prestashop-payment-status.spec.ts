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

  it('answers NOTHING when the flag is clear', () => {
    expect(
      derivePaymentStatusFromState(state({ paid: '0', name: 'Awaiting bank wire payment' })),
    ).toBeUndefined();
  });

  // THE REGRESSION THIS FILE EXISTS FOR.
  //
  // A first version reported `'awaiting'` here. `DISPATCH_BLOCKING_PAYMENT_STATUSES`
  // holds `awaiting` and `refunded`, so either one refuses a label with a 422,
  // and the label form hides its manual cash-on-delivery amount field for any
  // status but unknown or `cod`. Both were load-bearing on this source saying
  // nothing.
  //
  // `ps_order_state` cannot express cash on delivery - no flag, and the method
  // is free text on the ORDER - so the stock `Awaiting Cash On Delivery
  // validation` state would have refused to ship until it was paid, while the
  // buyer pays the courier on delivery. A deadlock with no escape state.
  it('never returns a status that would refuse a dispatch', () => {
    const everyShape = [
      state({ paid: '0', name: 'Awaiting cash on delivery validation' }),
      state({ paid: '0', name: 'Awaiting check payment' }),
      state({ paid: '0', name: 'Payment error' }),
      state({ paid: '1', name: 'Payment accepted' }),
      state({ paid: '1', name: 'Refunded' }),
      state({ paid: '0', name: 'Zwrot do nadawcy' }),
      state({ paid: '0', name: 'Canceled' }),
      state({ paid: '0', shipped: '1', name: 'Shipped' }),
      state({ paid: '0', delivered: '1', name: 'Delivered' }),
    ].map(derivePaymentStatusFromState);

    // Mirrors `DISPATCH_BLOCKING_PAYMENT_STATUSES`. Spelled out rather than
    // imported, because an integration package may not reach into the core
    // shipping policy - and because the two must be compared by a human when
    // either changes.
    expect(everyShape).not.toContain('awaiting');
    expect(everyShape).not.toContain('refunded');
  });

  // Withheld for a second reason as well: it is read from a LABEL, and the
  // refund vocabulary matches word stems, so "Zwrot do nadawcy" (return to
  // sender) would permanently refuse dispatch on a naming accident.
  it('answers nothing for a refund-labelled state rather than blocking it', () => {
    expect(derivePaymentStatusFromState(state({ paid: '1', name: 'Refunded' }))).toBeUndefined();
    expect(
      derivePaymentStatusFromState(state({ paid: '0', name: 'Zwrot do nadawcy' })),
    ).toBeUndefined();
  });

  // A cash-on-delivery parcel ships and is delivered while still unpaid, so
  // payment is read from the paid flag alone and never from a shipment flag.
  it('does NOT infer payment from a shipped or delivered state', () => {
    expect(
      derivePaymentStatusFromState(state({ paid: '0', shipped: '1', name: 'Shipped' })),
    ).toBeUndefined();
    expect(
      derivePaymentStatusFromState(state({ paid: '0', delivered: '1', name: 'Delivered' })),
    ).toBeUndefined();
  });

  it('never reports cod', () => {
    const answers = [
      state({ paid: '0', name: 'Awaiting cash on delivery validation' }),
      state({ paid: '1', name: 'Payment accepted' }),
    ].map(derivePaymentStatusFromState);
    expect(answers).not.toContain('cod');
  });

  it('reads the flag as truthy for both shapes PrestaShop returns', () => {
    expect(derivePaymentStatusFromState(state({ paid: '1' }))).toBe('paid');
    expect(derivePaymentStatusFromState(state({ paid: 'true' }))).toBe('paid');
  });
});
