/**
 * Fulfilment block reason (#2396, `W3a-7`, DESIGN §5.5)
 *
 * Why an order is **held** — not mirrored to any destination — and no work
 * object explains it.
 *
 * ## This union deliberately covers FEWER arms than #2396's text
 *
 * The issue body prescribes a reason for every non-routing outcome, including
 * the `ambiguous` arm. That reconciliation predates #2352, which landed
 * `'sourcing-ambiguous'` in `AUTHORITY_ATTENTION_REASON_DESCRIPTORS`
 * (`@openlinker/core/fulfillment-authority`) as spec row **A2-A**, with
 * `surfaces: ['order', 'connection']`, `producer: null`,
 * `origin: 'authority-resolution'` and — decisively — `counted: true`.
 *
 * So two enabled routers on one source is ALREADY reported at order grain and
 * ALREADY counted in `Needs attention (N)`, derived on every read by
 * `resolveAuthorities` and deliberately never persisted (a spec pins that it
 * has no producer with a `@ts-expect-error`). Persisting it here as well would
 * double-count the one number an operator acts on, which is worse than not
 * reporting it: it teaches them the count is noise.
 *
 * Hence: the `ambiguous` arm persists NOTHING, and neither does `routed` (work
 * exists, and `IFulfillmentWorkQueryService` (#2402) is the answer to "why is
 * this order not mirroring"). What is left is the genuinely novel fact this
 * union exists to report:
 *
 * > this order is held, and no work object explains why.
 *
 * ## #3485: once the OMS routes, a non-routed outcome is a HOLD too
 *
 * #2396 let a `refused` plan, a missing shipping address and an intercept error
 * fall back to the destination mirror ("the order must keep its ordinary
 * destination path"). With OpenLinker's OMS as the router that fallback created
 * the order in EVERY product master — two masters, two copies, one of them
 * failing after it had created a guest customer. Epic #3460 decides the order
 * stays in OpenLinker, so those three outcomes are held and named below, and
 * each stays re-routable: `refused` terminalises the decision to `abandoned`,
 * which frees the live-decision index, and `fulfillment.work.rerouteSweep`
 * re-enters routing for `routing-refused` / `routing-failed`.
 *
 * The routing decision row still records WHY a plan was refused; the block
 * answers the operator's question — why is this order waiting — on the order.
 *
 * ## Not `AUTHORITY_ATTENTION_PRODUCER_REASONS.routing`
 *
 * That producer is 1:1 to `'line-unfulfillable'` — *"a line cannot be shipped
 * from anywhere"*, a refund/return decision. None of the three states below is
 * that: each is a transient or contended condition that clears by itself or on
 * the next transition. Reusing it would persist a state the descriptor table
 * assigns to a different subsystem, which is the precise anti-pattern that file
 * names. Widening the producer union is another issue's vocabulary.
 *
 * @module libs/core/src/fulfillment/domain/types
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.5
 */

export const FulfillmentBlockReasonValues = [
  /**
   * The router may or may not have committed on its side, so the mirror is
   * withheld rather than risking a destination order for a parcel a holder is
   * already picking. The `routing_decisions` row stays `live` for resumption.
   */
  'routing-in-doubt',
  /** A peer holds the routing lock; the decision belongs to whoever wins it. */
  'routing-contended',
  /**
   * A live or terminalised decision already exists — possibly on another
   * connection. The #2047 write-path guard refused, and mirroring now could
   * double-ship an order some other route already owns.
   */
  'routing-already-live-elsewhere',
  /**
   * #3485 — the OMS router answered and OpenLinker could not commit the plan
   * (typically a line out of stock at every location). The detail names the
   * decision's abandon reason. Re-routed by `fulfillment.work.rerouteSweep`.
   */
  'routing-refused',
  /**
   * #3485 — the order carries no shipping address, so there is nothing to route
   * to. Clears on the re-ingestion that brings the address; not swept.
   */
  'routing-no-shipping-address',
  /**
   * #3485 — routing failed after the OMS router was selected. Held rather than
   * mirrored, because the claim is known to be on. The detail is the error NAME
   * only. Re-routed by `fulfillment.work.rerouteSweep`.
   */
  'routing-failed',
] as const;

export type FulfillmentBlockReason = (typeof FulfillmentBlockReasonValues)[number];

/**
 * The held states `fulfillment.work.rerouteSweep` re-enters routing for (#3485).
 *
 * `routing-no-shipping-address` is deliberately absent: only a source update can
 * supply an address, and that re-ingests the order on its own. The three #2396
 * states are absent too — in-doubt and contended resolve through the decision
 * row, and already-live-elsewhere is a guard, not a failure.
 */
export const REROUTABLE_FULFILLMENT_BLOCK_REASONS = [
  'routing-refused',
  'routing-failed',
] as const satisfies readonly FulfillmentBlockReason[];

/**
 * Read-side coercion, mirroring `isHoldReason` / `isSalesDocumentGateBlockReason`.
 *
 * The column is plain `text` with no check constraint, so a value written by a
 * newer release and then rolled back must read as "nothing recognised" rather
 * than widening the union at runtime.
 */
export const isFulfillmentBlockReason = (value: unknown): value is FulfillmentBlockReason =>
  typeof value === 'string' &&
  (FulfillmentBlockReasonValues as readonly string[]).includes(value);

/** What the intercept persists: a reason plus PII-free elaboration. */
export interface FulfillmentBlock {
  readonly reason: FulfillmentBlockReason;
  /** Ids and causes only — rendered verbatim to the operator, never filtered on. */
  readonly detail: string | null;
}
