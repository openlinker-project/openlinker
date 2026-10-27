/**
 * Unit tests for the Allegro payment-status derivation helper (#928).
 *
 * Locks the COD-vs-prepaid discriminator (Allegro sets `payment.finishedAt`
 * even for cash-on-delivery, so the helper keys off `payment.type` first) and
 * the prepaid rule: paid when money arrived, or when the form reached
 * `READY_FOR_PROCESSING` with a finished payment - never on `finishedAt` alone,
 * which a failed payment attempt also sets (E2E-22).
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 */
import {
  deriveAllegroPaymentStatus,
  isAllegroCheckoutSettled,
  type AllegroCheckoutPaymentFacts,
} from '../allegro-payment-status';
import type { AllegroCheckoutForm } from '../../../domain/types/allegro-api.types';

type Payment = AllegroCheckoutForm['payment'];

function form(payment: Payment, status?: string): AllegroCheckoutPaymentFacts {
  return status === undefined ? { payment } : { payment, status };
}

describe('deriveAllegroPaymentStatus', () => {
  it('should return cod for CASH_ON_DELIVERY even when finishedAt is set', () => {
    // Allegro sets finishedAt on COD too (form submission, not payment) — the
    // type discriminator must win so COD is not misread as paid.
    const payment: Payment = { type: 'CASH_ON_DELIVERY', finishedAt: '2026-05-31T10:00:00Z' };
    expect(deriveAllegroPaymentStatus(form(payment, 'READY_FOR_PROCESSING'))).toBe('cod');
  });

  it('should return cod for CASH_ON_DELIVERY without finishedAt', () => {
    expect(deriveAllegroPaymentStatus(form({ type: 'CASH_ON_DELIVERY' }))).toBe('cod');
  });

  it('should return paid for a normally paid ONLINE checkout', () => {
    const payment: Payment = {
      type: 'ONLINE',
      finishedAt: '2026-05-31T10:00:00Z',
      paidAmount: { amount: '510.94', currency: 'PLN' },
    };
    expect(deriveAllegroPaymentStatus(form(payment, 'READY_FOR_PROCESSING'))).toBe('paid');
  });

  it('should return paid on a positive paidAmount even without a form status', () => {
    const payment: Payment = {
      type: 'WIRE_TRANSFER',
      finishedAt: '2026-05-31T10:00:00Z',
      paidAmount: { amount: '99.00', currency: 'PLN' },
    };
    expect(deriveAllegroPaymentStatus(form(payment))).toBe('paid');
  });

  it('should return awaiting for a non-COD order that has not completed payment', () => {
    expect(deriveAllegroPaymentStatus(form({ type: 'ONLINE' }, 'BOUGHT'))).toBe('awaiting');
  });

  it('should return awaiting for a failed payment attempt: FILLED_IN, finishedAt, no paidAmount (E2E-22)', () => {
    // Live sandbox: a PayU "negative authorization" left the form at FILLED_IN
    // with finishedAt set and paidAmount absent. It must not read as paid.
    const payment: Payment = { type: 'ONLINE', finishedAt: '2026-10-26T12:13:39.642Z' };
    expect(deriveAllegroPaymentStatus(form(payment, 'FILLED_IN'))).toBe('awaiting');
    expect(isAllegroCheckoutSettled(form(payment, 'FILLED_IN'))).toBe(false);
  });

  it('should return awaiting for an abandoned attempt that reports paidAmount null', () => {
    const payment = {
      type: 'ONLINE',
      finishedAt: '2026-10-26T12:13:39.642Z',
      paidAmount: null,
    } as unknown as Payment;
    expect(deriveAllegroPaymentStatus(form(payment, 'FILLED_IN'))).toBe('awaiting');
  });

  it('should return awaiting when the paid amount is zero and the form is not ready', () => {
    const payment: Payment = {
      type: 'ONLINE',
      finishedAt: '2026-05-31T10:00:00Z',
      paidAmount: { amount: '0.00', currency: 'PLN' },
    };
    expect(deriveAllegroPaymentStatus(form(payment, 'FILLED_IN'))).toBe('awaiting');
  });

  it('should return paid for a voucher-covered checkout: READY_FOR_PROCESSING with paidAmount 0', () => {
    const payment: Payment = {
      type: 'ONLINE',
      finishedAt: '2026-05-31T10:00:00Z',
      paidAmount: { amount: '0.00', currency: 'PLN' },
    };
    expect(deriveAllegroPaymentStatus(form(payment, 'READY_FOR_PROCESSING'))).toBe('paid');
    expect(isAllegroCheckoutSettled(form(payment, 'READY_FOR_PROCESSING'))).toBe(true);
  });

  it('should return paid for READY_FOR_PROCESSING with a finished payment and no paidAmount', () => {
    const payment: Payment = { type: 'ONLINE', finishedAt: '2026-05-31T10:00:00Z' };
    expect(deriveAllegroPaymentStatus(form(payment, 'READY_FOR_PROCESSING'))).toBe('paid');
  });

  it('should return awaiting for READY_FOR_PROCESSING without a finished payment', () => {
    expect(deriveAllegroPaymentStatus(form({ type: 'ONLINE' }, 'READY_FOR_PROCESSING'))).toBe(
      'awaiting'
    );
  });
});

describe('isAllegroCheckoutSettled', () => {
  it('should settle a paid prepaid order and a submitted COD order only', () => {
    expect(
      isAllegroCheckoutSettled(
        form({ type: 'ONLINE', finishedAt: 'x', paidAmount: { amount: '1', currency: 'PLN' } })
      )
    ).toBe(true);
    expect(isAllegroCheckoutSettled(form({ type: 'CASH_ON_DELIVERY', finishedAt: 'x' }))).toBe(true);
    expect(isAllegroCheckoutSettled(form({ type: 'CASH_ON_DELIVERY' }))).toBe(false);
    expect(isAllegroCheckoutSettled(form({ type: 'ONLINE', finishedAt: 'x' }))).toBe(false);
  });
});
