/**
 * Source Refund Observation
 *
 * The neutral shape of a payment refund a source channel reports about an
 * order it sold. It is an OBSERVATION of money that already moved on the
 * channel; OpenLinker never moves it (ADR-056).
 *
 * @module domain/types
 */

export interface SourceRefundObservation {
  /** The channel's own refund id. The idempotency key is derived from it. */
  externalRefundId: string;
  /** Decimal string (e.g. "317.22"), the refund's total value as the channel states it. */
  amount: string;
  /** ISO 4217, 3-letter. */
  currency: string;
  /** The channel's own instant, or null when it reports none (never OL's clock). */
  occurredAt: Date | null;
}
