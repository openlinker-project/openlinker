/**
 * What a WooCommerce order says about the money (#3365).
 *
 * This adapter reported no payment status at all, so an `auto-on-paid`
 * connection never issued a document for a WooCommerce sale - and therefore
 * never produced the warehouse release that moves stock. These cases pin the
 * rule that closed it, including the two places it deliberately refuses to
 * guess.
 */
import { deriveWooCommercePaymentStatus } from '../woocommerce-order-source.adapter';

type Input = Parameters<typeof deriveWooCommercePaymentStatus>[0];

function order(partial: Partial<Input> & { status: string }): Input {
  return { date_paid: null, date_paid_gmt: null, ...partial };
}

describe('deriveWooCommercePaymentStatus', () => {
  it('reports paid when WooCommerce stamped its own payment date', () => {
    expect(
      deriveWooCommercePaymentStatus(
        order({ status: 'on-hold', date_paid_gmt: '2026-09-28T10:00:00' }),
      ),
    ).toBe('paid');
  });

  // The stamp beats the status, because it is the gateway's own answer. A
  // store that settles by hand leaves an order `on-hold` after taking the
  // money.
  it('prefers the stamp over a status that would read as unpaid', () => {
    expect(
      deriveWooCommercePaymentStatus(order({ status: 'pending', date_paid: '2026-09-28T10:00:00' })),
    ).toBe('paid');
  });

  it.each(['processing', 'completed', 'PROCESSING'])(
    'reports paid for the core status %s even with no stamp',
    (status) => {
      expect(deriveWooCommercePaymentStatus(order({ status }))).toBe('paid');
    },
  );

  // THE REGRESSION THIS FILE EXISTS FOR.
  //
  // A first version reported `'awaiting'` for these.
  // `DISPATCH_BLOCKING_PAYMENT_STATUSES` holds `awaiting` and `refunded`, so
  // either one refuses a label with a 422, and the label form hides its manual
  // cash-on-delivery amount field for any status but unknown or `cod` - and its
  // own docblock names WooCommerce among the sources that keep that path.
  //
  // WooCommerce cannot express cash on delivery here: the method is
  // `payment_method`, a free-text slug a plugin chooses. So an unpaid COD order
  // would have been refused a label until it was paid, while the buyer pays the
  // courier on delivery.
  it.each([
    'pending',
    'on-hold',
    'failed',
    'cancelled',
    'checkout-draft',
    'refunded',
    'awaiting-shipment',
  ])('never returns a status that would refuse a dispatch, for %s', (status) => {
    const answer = deriveWooCommercePaymentStatus(order({ status }));
    expect(answer).not.toBe('awaiting');
    expect(answer).not.toBe('refunded');
  });

  // Withheld even with WooCommerce's own payment stamp on the row: a refund is
  // a dispatch-blocking answer, and this seam does not give one.
  it('answers nothing for a refunded order, stamp or no stamp', () => {
    expect(
      deriveWooCommercePaymentStatus(
        order({ status: 'refunded', date_paid_gmt: '2026-09-28T10:00:00' }),
      ),
    ).toBeUndefined();
    expect(deriveWooCommercePaymentStatus(order({ status: 'refunded' }))).toBeUndefined();
  });

  // A plugin may register its own status. Reading it as `awaiting` would
  // assert that somebody has not paid on the strength of a word this adapter
  // has never seen.
  it('answers nothing for a status it does not recognise', () => {
    expect(deriveWooCommercePaymentStatus(order({ status: 'awaiting-shipment' }))).toBeUndefined();
  });

  // `payment_method` is a free-text slug a plugin chooses, so COD is never
  // inferred; an unpaid cash-on-delivery order is simply awaiting, which is
  // true.
  it('never reports cod', () => {
    const answers = ['pending', 'on-hold', 'processing', 'completed', 'refunded'].map((status) =>
      deriveWooCommercePaymentStatus(order({ status })),
    );
    expect(answers).not.toContain('cod');
  });

  it('answers nothing for a status it does not recognise', () => {
    expect(deriveWooCommercePaymentStatus(order({ status: 'wc-partial' }))).toBeUndefined();
  });

  it('treats a blank stamp as no stamp at all', () => {
    expect(
      deriveWooCommercePaymentStatus(order({ status: 'pending', date_paid: '   ' })),
    ).toBeUndefined();
  });
});

// A core `cod` order is created `processing`, which the status fallback reads as
// paid; the shipment gate then stripped the COD amount from the courier label
// (#3294). The core gateway id is the one thing about a payment method this
// adapter CAN state, so it wins over the status fallback - but never over
// WooCommerce's own payment stamp, and never for a dead order.
describe('deriveWooCommercePaymentStatus - core cash on delivery (#3294)', () => {
  it.each(['processing', 'completed', 'on-hold', 'pending'])(
    'reports cod, not paid, for a core COD order in status %s',
    (status) => {
      expect(deriveWooCommercePaymentStatus(order({ status, payment_method: 'cod' }))).toBe('cod');
    },
  );

  it('lets WooCommerce\'s own payment stamp win: a COD order it records as paid is paid', () => {
    expect(
      deriveWooCommercePaymentStatus(
        order({ status: 'completed', payment_method: 'cod', date_paid_gmt: '2026-09-28T10:00:00' }),
      ),
    ).toBe('paid');
  });

  it.each(['cancelled', 'failed', 'trash'])(
    'makes no payment claim for a core COD order in the dead status %s',
    (status) => {
      expect(
        deriveWooCommercePaymentStatus(order({ status, payment_method: 'cod' })),
      ).toBeUndefined();
    },
  );

  it('keeps withholding a refunded COD order', () => {
    expect(
      deriveWooCommercePaymentStatus(order({ status: 'refunded', payment_method: 'cod' })),
    ).toBeUndefined();
  });

  it.each(['bacs', 'paypal', 'cod_custom', undefined])(
    'reads %s exactly as before: processing is still paid',
    (payment_method) => {
      expect(
        deriveWooCommercePaymentStatus(order({ status: 'processing', payment_method })),
      ).toBe('paid');
    },
  );

  it('never reports awaiting for a core COD order, whatever its status', () => {
    for (const status of ['pending', 'on-hold', 'processing', 'completed']) {
      expect(deriveWooCommercePaymentStatus(order({ status, payment_method: 'cod' }))).not.toBe(
        'awaiting',
      );
    }
  });
});
