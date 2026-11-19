/**
 * Allegro payment refund mapper
 *
 * Projects `GET /payments/refunds` rows onto the neutral
 * `SourceRefundObservation`. Rows that are not settled, or that lack an id, an
 * amount or a currency, are dropped: recording a refund OL cannot name or price
 * would be worse than missing it, and the next poll re-reads it.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 */
import type { SourceRefundObservation } from '@openlinker/core/orders';
import {
  ALLEGRO_REFUND_SETTLED_STATUS,
  type AllegroPaymentRefundWire,
} from '../../domain/types/allegro-payment-refund.types';

/**
 * `orderId` is a client-side guard, not a convenience: the endpoint has been seen
 * to ignore a filter it did not recognise and answer with every refund the
 * seller has, which would book other orders' money on this one. A row that does
 * not name the requested order (or names none) is therefore dropped.
 */
export function toSourceRefundObservations(
  wires: readonly AllegroPaymentRefundWire[],
  orderId: string
): SourceRefundObservation[] {
  const observations: SourceRefundObservation[] = [];
  for (const wire of wires) {
    const amount = wire.totalValue?.amount;
    const currency = wire.totalValue?.currency;
    if (
      wire.order?.id !== orderId ||
      wire.status !== ALLEGRO_REFUND_SETTLED_STATUS ||
      !wire.id ||
      !amount ||
      !currency ||
      !Number.isFinite(Number(amount)) ||
      Number(amount) <= 0
    ) {
      continue;
    }
    const occurredAt = wire.createdAt ? new Date(wire.createdAt) : null;
    observations.push({
      externalRefundId: wire.id,
      amount,
      currency,
      occurredAt: occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : null,
    });
  }
  return observations;
}
