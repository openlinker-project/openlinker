/**
 * Unit tests for the Allegro payment-status derivation helper (#928).
 *
 * Locks the COD-vs-prepaid discriminator: because Allegro sets
 * `payment.finishedAt` even for cash-on-delivery, the helper must key off
 * `payment.type` first, not `finishedAt` alone.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 */
import { deriveAllegroPaymentStatus } from '../allegro-payment-status';
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

  it('should return paid for any other prepaid type once finishedAt is present', () => {
    const payment: Payment = { type: 'BANK_TRANSFER', finishedAt: '2026-05-31T10:00:00Z' };
    expect(deriveAllegroPaymentStatus(payment)).toBe('paid');
  });
});
