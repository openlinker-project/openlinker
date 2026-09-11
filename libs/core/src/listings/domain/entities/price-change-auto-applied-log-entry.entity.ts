/**
 * Price Change Auto-Applied Log Entry (#3144, ADR-072 decision 3)
 *
 * One row per price change published WITHOUT review, because its
 * (destination, source) pair is set to `automatic` sync mode. The deliberately
 * lightweight stand-in for a full "Daily digest" mode (cut during design, see
 * ADR-072's Alternatives — no notification/summary surface exists anywhere in
 * the app). Read by #3145's `GET /listings/price-changes/auto-applied`.
 *
 * Anemic per ADR-011 — no behavior, purely a fact.
 *
 * @module libs/core/src/listings/domain/entities
 */

export class PriceChangeAutoAppliedLogEntry {
  constructor(
    public readonly id: string,
    public readonly productVariantId: string,
    public readonly destinationConnectionId: string,
    public readonly sourceConnectionId: string,
    /**
     * The price this key carried immediately before this change, or `null`
     * for a first-ever detection with no recorded baseline (#3159's
     * `computedOldAmount === null` state, #3161 review) — never fabricated
     * as equal to `newAmount`.
     */
    public readonly oldAmount: number | null,
    public readonly newAmount: number,
    public readonly currency: string,
    public readonly appliedAt: Date
  ) {}
}
