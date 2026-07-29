/**
 * Required-to-Sell Preflight Types
 *
 * A publish can succeed on the destination while still being unbuyable there
 * — e.g. a WooCommerce product missing weight/dimensions breaks live-rate
 * shipping calc at checkout, or a zero-stock product can't be purchased at
 * all. `checkRequiredToSell` (the co-located pure checker) reports these
 * "would publish but not be sellable" signals from data already resolved
 * onto a `PublishProductCommand` — no I/O, no adapter calls (#1842).
 *
 * `severity: 'block'` gates the publish (mirrors the existing builder gates —
 * unresolved required parameter, unresolvable price); `'warn'` is a soft
 * signal the operator can acknowledge and publish through anyway. Every rule
 * shipped today is `'warn'` (per the #1842 assumption that non-hard-required
 * fields soft-block with an operator override) — the severity field exists so
 * a future hard-required rule doesn't need a shape change.
 *
 * Cross-cutting seam: this file only models the shop-publish projection
 * (`RequiredToSellCheckInput`, mirroring the relevant `PublishProductCommand`
 * fields). A marketplace analogue (delivery/return-policy completeness on
 * `CreateOfferCommand`) would define its own input projection and reuse the
 * same `RequiredToSellIssue` output shape — not built here, no marketplace
 * requirement is scoped to #1838 yet.
 *
 * @module libs/core/src/listings/domain/types
 */

/**
 * `block` fails the publish (same posture as the builder's existing
 * price/parameter gates); `warn` is informational and operator-overridable.
 */
export const RequiredToSellSeverityValues = ['block', 'warn'] as const;
export type RequiredToSellSeverity = (typeof RequiredToSellSeverityValues)[number];

export const RequiredToSellIssueCodeValues = [
  'OUT_OF_STOCK',
  'MISSING_WEIGHT',
  'MISSING_DIMENSIONS',
] as const;
export type RequiredToSellIssueCode = (typeof RequiredToSellIssueCodeValues)[number];

/** One "publishes but not sellable" signal. */
export interface RequiredToSellIssue {
  code: RequiredToSellIssueCode;
  severity: RequiredToSellSeverity;
  /** Dotted field path on `PublishProductCommand` the issue is about (e.g. `stock`, `commerce.dimensions`). */
  field: string;
  /** Operator-facing explanation of why the field matters for sellability. */
  message: string;
}

/**
 * Pure projection of the `PublishProductCommand` fields the preflight reads.
 * Kept as its own type (rather than taking the full command) so the checker
 * has no dependency on command assembly and can run over partial/FE-known
 * data as more fields become available client-side (#1842 dependency: S20's
 * weight/dimensions FE fields).
 */
export interface RequiredToSellCheckInput {
  stock: number;
  weight?: number;
  dimensions?: { length?: number; width?: number; height?: number };
}
