/**
 * Hold Reason (#2305, ADR-059; design adjudication #4 at DESIGN §"Adjudications" item 4)
 *
 * The ONE merged hold-reason vocabulary, used at **both hold grains** — the
 * order grain (`order_holds`, #2309-and-later) and the fulfilment-work grain
 * (`fulfillment_holds`). §5 and §6 of the design each invented a reason union;
 * adjudication #4 merged them into this single list precisely so the two grains
 * cannot drift into two dialects of the same idea.
 *
 * **Unprefixed on purpose (REVIEW H14).** The design prose calls this
 * `OrderHoldReason`; the shipped identifier is `HoldReason`, because an
 * `Order`-prefixed name would be actively misleading at the fulfilment-work
 * grain that shares it. A later reader should NOT "fix" this back to
 * `OrderHoldReason` — the divergence is decided, not accidental.
 *
 * **The two grains stay independent** (adjudication #4): a held work item does
 * not implicitly hold the order, and releasing a work hold never releases an
 * order hold. Sharing the vocabulary is not sharing the state.
 *
 * **Closed union — "actions yes, states no" (ADR-059).** Plugins may contribute
 * actions; they may never add a reason. An open reason axis can never be closed
 * again, and every reason here has to be renderable by the FE mirror and
 * matchable by a SQL filter.
 *
 * `external` is the posture-B import of an unmappable VENDOR hold — the vendor
 * says the order is held for a reason OL has no value for. It is a named value
 * rather than an extras bag because a second adapter needed it, which is the
 * ADR-042 extras-bag PROMOTION rule: keys stay adapter-private until a second
 * implementer proves the concept is cross-platform.
 *
 * @module libs/core/src/order-lifecycle/domain/types
 * @see docs/architecture/adrs/059-order-lifecycle-derived-phase.md
 */

/**
 * The eight hold reasons, verbatim from design adjudication #4.
 *
 * - `payment-review`  — settlement is being verified before the order proceeds.
 * - `fraud-review`    — a risk check is outstanding.
 * - `operator`        — a human deliberately paused this order; no further reason claimed.
 * - `stock-shortfall` — the committed quantity is not actually available to pick.
 * - `address-invalid` — the delivery address failed validation and cannot be shipped to.
 * - `awaiting-amendment` — an ADR-044 change proposal is outstanding against the order.
 * - `awaiting-customer-confirmation` — the buyer, not the operator, is the blocker.
 * - `external`        — posture B: the vendor holds the order for a reason OL cannot classify.
 */
export const HoldReasonValues = [
  'payment-review',
  'fraud-review',
  'operator',
  'stock-shortfall',
  'address-invalid',
  'awaiting-amendment',
  'awaiting-customer-confirmation',
  'external',
] as const;

export type HoldReason = (typeof HoldReasonValues)[number];

/**
 * Coerce an untrusted value (a persisted `activeHoldReason`, a request DTO) to
 * the union. Pure; no default — an unrecognised reason must surface as "not a
 * hold reason" rather than silently becoming `operator`, which would attribute
 * a machine's hold to a human.
 */
export function isHoldReason(value: unknown): value is HoldReason {
  return (
    typeof value === 'string' &&
    (HoldReasonValues as readonly string[]).includes(value)
  );
}
