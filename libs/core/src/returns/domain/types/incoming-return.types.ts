/**
 * Incoming Return Types
 *
 * The neutral projection of a return **as the source reports it** — the returns
 * counterpart of `IncomingOrder`. Read-only and non-authoritative: it carries
 * what the marketplace observed, never what OpenLinker decided. Custody,
 * disposition, restock and refund authority belong to the OL-owned
 * `ReturnRecord` aggregate ABOVE this projection (ADR-060), and are deliberately
 * ABSENT here — as are `resolvedOrderLineId` (core-resolved, never
 * adapter-supplied), any mapped `RefundReason`, and refund amounts.
 *
 * Domain-only: no framework dependencies.
 *
 * @module libs/core/src/returns/domain/types
 * @see docs/plans/analysis/SPIKE-2289-allegro-returns-feed.md
 * @see docs/architecture/adrs/060-returns-aggregate-above-source-projection.md
 */

/**
 * One returned line as the source reports it.
 */
export interface IncomingReturnLine {
  /**
   * Source-native line identifier, when the source assigns one. A source that
   * identifies lines only positionally (Erli) stringifies that index
   * **adapter-side** — core never derives an identifier.
   */
  externalLineId?: string;

  /**
   * Source-native offer/listing identifier this line refers to, best-effort.
   * This is the only line-level linkage a source may supply; resolving it to an
   * OL order line is core's job, not the adapter's.
   */
  offerId?: string;

  sku?: string;

  name?: string;

  /**
   * Returned quantity. Spelled correctly here regardless of what the source
   * calls it on the wire (Erli's `quentity` is normalised adapter-side).
   */
  quantity: number;

  /**
   * Per-unit price as the source reports it, when reported. A bare number,
   * matching the `IncomingOrderItem.price` precedent; a currency field is
   * additive later if a money consumer needs one.
   */
  unitPrice?: number;

  /**
   * The source's own reason string, **verbatim and open-world** — never a closed
   * union. Mapping a raw reason onto an OL vocabulary is core's decision, made
   * where the aggregate is written.
   */
  reasonRaw?: string;

  serialNumbers?: string[];

  /**
   * Untouched source payload for this line, for debugging. Core never branches
   * on it.
   */
  raw?: unknown;
}

/**
 * A full return hydrated from the source by `ReturnSourceReader.getReturn`.
 */
export interface IncomingReturn {
  externalReturnId: string;

  /**
   * The source-native order this return refers to, or `null` when the source
   * reports none.
   *
   * Nullable, **not optional**: an orphan return is a first-class observation,
   * not a missing field. A source that cannot state the order must say so, so
   * that "unknown order" and "adapter forgot to map it" are distinguishable.
   */
  externalOrderId: string | null;

  /**
   * Human-facing reference the source shows its users, when it has one.
   */
  referenceNumber?: string;

  /**
   * The source's own status string, **verbatim**. Core never branches on it —
   * see {@link IncomingReturn.isTerminalAtSource} for the single permitted
   * derivation, and note that it is made adapter-side.
   */
  rawStatus: string;

  /**
   * When the source created the return (ISO 8601).
   */
  createdAt: string;

  /**
   * Optional adapter-computed hint: the source considers this return finished.
   *
   * This is **the only permitted `rawStatus` derivation, made adapter-side, and
   * it bounds the pass-2 sweep only — never drives a lifecycle.** Nothing in the
   * OL returns lifecycle may read it: a terminal source status is not an OL
   * disposition, and treating it as one would hand a marketplace authority
   * ADR-060 places with the operator. Absent means "the source did not say",
   * which a sweep must treat as still-open.
   */
  isTerminalAtSource?: boolean;

  buyerEmail?: string;

  /**
   * Source-native buyer/account identifier, when reported.
   */
  marketplaceId?: string;

  lines: IncomingReturnLine[];

  /**
   * Untouched source payload, for debugging. Core never branches on it.
   */
  raw?: unknown;
}
