/**
 * Unit tests for the Allegro payment-status derivation helper (#928).
 *
 * Locks the COD-vs-prepaid discriminator: because Allegro sets
 * `payment.finishedAt` even for cash-on-delivery, the helper must key off
 * `payment.type` first, not `finishedAt` alone.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 */
import { deriveAllegroPaymentStatus, isAllegroCheckoutSettled } from '../allegro-payment-status';
import type { AllegroCheckoutForm } from '../../../domain/types/allegro-api.types';

type Payment = AllegroCheckoutForm['payment'];

describe('deriveAllegroPaymentStatus', () => {
  it('should return cod for CASH_ON_DELIVERY even when finishedAt is set', () => {
    // Allegro sets finishedAt on COD too (form submission, not payment) — the
    // type discriminator must win so COD is not misread as paid.
    const payment: Payment = { type: 'CASH_ON_DELIVERY', finishedAt: '2026-05-31T10:00:00Z' };
    expect(deriveAllegroPaymentStatus(payment)).toBe('cod');
  });

  it('should return cod for CASH_ON_DELIVERY without finishedAt', () => {
    const payment: Payment = { type: 'CASH_ON_DELIVERY' };
    expect(deriveAllegroPaymentStatus(payment)).toBe('cod');
  });

  it('should return paid for a prepaid (ONLINE) order with finishedAt', () => {
    const payment: Payment = {
      type: 'ONLINE',
      finishedAt: '2026-05-31T10:00:00Z',
      paidAmount: { amount: '510.94', currency: 'PLN' },
    };
    expect(deriveAllegroPaymentStatus(payment)).toBe('paid');
  });

  it('should return awaiting for a non-COD order that has not completed payment', () => {
    const payment: Payment = { type: 'ONLINE' };
    expect(deriveAllegroPaymentStatus(payment)).toBe('awaiting');
  });

  it('should return paid for any other prepaid type once money has arrived', () => {
    const payment: Payment = {
      type: 'WIRE_TRANSFER',
      finishedAt: '2026-05-31T10:00:00Z',
      paidAmount: { amount: '99.00', currency: 'PLN' },
    };
    expect(deriveAllegroPaymentStatus(payment)).toBe('paid');
  });

  it('should return awaiting when a payment attempt finished but nothing was paid (E2E-22)', () => {
    // Live sandbox shape after the buyer abandoned the PayU page: finishedAt
    // is set, paidAmount is null. It used to read as paid.
    const payment = {
      type: 'ONLINE',
      finishedAt: '2026-10-26T12:13:39.642Z',
      paidAmount: null,
    } as unknown as Payment;
    expect(deriveAllegroPaymentStatus(payment)).toBe('awaiting');
    expect(isAllegroCheckoutSettled(payment)).toBe(false);
  });

  it('should return awaiting when the paid amount is zero', () => {
    const payment: Payment = {
      type: 'ONLINE',
      finishedAt: '2026-05-31T10:00:00Z',
      paidAmount: { amount: '0.00', currency: 'PLN' },
    };
    expect(deriveAllegroPaymentStatus(payment)).toBe('awaiting');
  });
});

describe('isAllegroCheckoutSettled', () => {
  it('should settle a paid prepaid order and a submitted COD order only', () => {
    expect(
      isAllegroCheckoutSettled({ type: 'ONLINE', finishedAt: 'x', paidAmount: { amount: '1', currency: 'PLN' } })
    ).toBe(true);
    expect(isAllegroCheckoutSettled({ type: 'CASH_ON_DELIVERY', finishedAt: 'x' })).toBe(true);
    expect(isAllegroCheckoutSettled({ type: 'CASH_ON_DELIVERY' })).toBe(false);
    expect(isAllegroCheckoutSettled({ type: 'ONLINE', finishedAt: 'x' })).toBe(false);
  });
});
