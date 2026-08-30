/**
 * Fulfilment execution I/O — what crosses `FulfillmentExecutorPort` (#2398, DESIGN §5.4)
 *
 * The shapes an executor is handed and the shape it answers with. DESIGN §5.4 names three
 * implementer shapes for one port — a 3PL adapter (API submit + webhook progress), the
 * OL-OMS plugin (auto-accept + pick list), an enterprise DOMS (3PL shape, richer reject
 * vocabulary) — and nothing in core knows which, which is why this file carries no
 * platform vocabulary at all.
 *
 * ## Six properties of the design
 *
 * **(a) `blocking` is the loop terminator, not a severity flag.** Without it, re-source plus
 * a deterministic sort is an infinite loop *by construction*: the same router, given the same
 * candidate set, re-picks the holder that just refused. `blocking: true` excludes the
 * rejecter from re-sourcing; `false` means "not this time" and leaves it a candidate. It is
 * **non-optional**, and that is load-bearing rather than stylistic — `blocking?: boolean`
 * reads `undefined`, which is falsy, so the rejecter would NOT be excluded and the loop the
 * field exists to prevent would run anyway. A compile-time guard beside this file pins it.
 *
 * **(b) `reason` is OPAQUE; `detail` is prose.** The rejecter knows why, core does not. An
 * enterprise DOMS has a richer reject vocabulary than a 3PL and neither is core's to
 * enumerate — the `RoutingRuleRef.name` / `RoutingUnfulfillableLine.reason` precedent.
 *
 * **(c) The lines are minimal by construction** (ADR-062 Decision 2). A domain entity handed
 * to a plugin re-opens every field it will ever grow, so what crosses is an explicit
 * allowlist: the work line, the variant, the quantity. No sku, no title, no price — an
 * adapter holds `identifierMapping` in its `HostServices` bag and resolves whatever its
 * vendor needs. The discipline is the MCP tools': enumerate, never spread.
 *
 * **(d) `idempotencyKey` is mandatory, caller-minted, and carries a stated GUARANTEE.**
 * The format is `work:{workId}:{assignmentAttempt}`, where `assignmentAttempt` is the
 * persisted monotonic counter on the work row (#2391), incremented only by a router-driven
 * re-request and written BEFORE the outbound call — never the job-runner attempt, which
 * changes on exactly the retries the key must survive (the Amazon MCF
 * `sellerFulfillmentOrderId` model). The guarantee: **a repeat under the same key must
 * return the ORIGINAL outcome and must never create a second assignment.** Stating the
 * format alone would leave an implementer a mandatory field it cannot honour, and would make
 * the counter's whole design — bumped by a re-request, never by a retry — meaningless.
 * #2399 owns the counter; this file owns the contract.
 *
 * **(e) A holder-reported instant is the HOLDER's, never OL's** (#2336 / #2367 / #2371).
 * `acceptedAt` and `observedAt` each describe something that happened in another system OL
 * did not witness, so each is `null` when the holder reports none rather than filled with
 * `new Date()`. OL's clock is not a witness to a third party's act.
 *
 * **(f) There is no `pending` arm.** #2393 declared one on `RoutingPlan` for a genuinely
 * asynchronous DOMS and refused it. Here the contract is two arms, and inventing a third
 * that nothing can produce would be scope rather than safety — an unrecognised status is
 * refused instead, by `assertFulfillmentRequestResultRecognised`, which needs no shape.
 *
 * ## No new sibling-context edge
 *
 * `FulfillmentCancellationReason` is imported **type-only** from
 * `@openlinker/core/fulfillment-authority`, already an authorized specifier for this leaf
 * (#2391); `RoutingShipTo` and `FulfillmentWorkRef` are same-leaf. Nothing here spends a new
 * `ZERO_SIBLING_EDGE_LEAVES` entry, and reusing `RoutingShipTo` rather than declaring a
 * second ship-to shape is what buys that: this port opens **no new PII surface**, because
 * its arms, its allowlist and its forbidden-key guards are the ones #2393 already ships.
 *
 * Note the import must be statement-level `import type { … }`. The inline
 * `import { type X }` form is classified as a VALUE import by `barrel-purity.spec.ts` and
 * fails, even though inline is the repo's prevailing style elsewhere.
 *
 * @module libs/core/src/fulfillment/domain/types
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.4
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 * @see docs/architecture/adrs/062-trust-posture-authority-holding-capabilities.md
 */
import type { FulfillmentCancellationReason } from '@openlinker/core/fulfillment-authority';
import type { FulfillmentWorkRef } from './fulfillment-work.types';
import type { RoutingShipTo } from './routing-ship-to.types';

/**
 * One work line's participation in a fulfilment request.
 *
 * `workLineId` is `FulfillmentWorkLine.id` — **not** `orderLineId`, which also exists on that
 * shape and names the order's line instead. Both live on the work line; only the work line's
 * own id identifies the unit an executor is being asked to fulfil.
 */
export interface FulfillmentRequestLine {
  readonly workLineId: string;
  readonly productVariantId: string;
  readonly quantity: number;
}

/**
 * Everything an executor is told about the work it is being offered.
 *
 * There is no `FulfillmentWork` here and there must not be one, for the reason `RoutingInput`
 * carries no `Order`: ADR-062 Decision 2 bounds this shape by construction.
 *
 * `orderId` is a plain internal id and crosses as the adapter's **correlation key** — it is
 * an `ol_order_*` value, meaningless to a vendor on its own, which an adapter maps to its own
 * reference through the `identifierMapping` in its `HostServices` bag. `RoutingInput.orderId`
 * is the precedent.
 *
 * `deliveryMethod` is an OPAQUE key at the grain `FulfillmentWork.deliveryMethod` holds —
 * ADR-054 keeps order-layer sourcing separate from the shipping layer's dispatch resolution,
 * which stays authoritative for label mechanics, so no delivery vocabulary is restated here.
 */
export interface FulfillmentRequest {
  readonly work: FulfillmentWorkRef;
  readonly orderId: string;
  readonly lines: readonly FulfillmentRequestLine[];
  readonly shipTo: RoutingShipTo;
  readonly deliveryMethod: string | null;
  readonly idempotencyKey: string;
}

/**
 * Asking an accepting holder to give the work back.
 *
 * Carries no lines: ADR-054 splits the WORK rather than the order, so a partial cancellation
 * is expressible as cancelling a narrower work object. It also carries no `version` — the
 * optimistic-concurrency token on `FulfillmentWork` is #2406's read-model concern, and
 * handing it across this port would invite an executor to arbitrate a race it cannot see.
 */
export interface FulfillmentCancellationRequest {
  readonly work: FulfillmentWorkRef;
  readonly reason: FulfillmentCancellationReason;
  readonly idempotencyKey: string;
}

/** The holder took the work. */
export interface AcceptedFulfillmentRequest {
  readonly status: 'accepted';
  /** The holder's own reference for the work, `null` when it assigns none. */
  readonly externalWorkId: string | null;
  /** The HOLDER's instant. `null` when not reported — never `new Date()`. */
  readonly acceptedAt: Date | null;
}

/** The holder refused. */
export interface RejectedFulfillmentRequest {
  readonly status: 'rejected';
  /** The rejecter's own vocabulary. Opaque — never parsed or validated here. */
  readonly reason: string;
  /**
   * Whether the rejecter is excluded from re-sourcing.
   *
   * NON-OPTIONAL by design — see property (a) in this file's header.
   */
  readonly blocking: boolean;
  /** Operator-facing prose from the rejecter, `null` when it offers none. */
  readonly detail: string | null;
}

/**
 * What both port methods answer with.
 *
 * The two arms correspond deliberately to two members of the existing
 * `FulfillmentRequestStatus` negotiation axis (`accepted` / `rejected`, #2391): #2399 stamps
 * `FulfillmentWork.requestStatus` straight from this result, so the shared spelling is the
 * point rather than a collision. `assertFulfillmentRequestResultRecognised` is named for the
 * RESULT and not for that union precisely so the two are not confused — see its own file.
 *
 * `requestCancellation` returns the same type on purpose: cancelling work a holder has
 * already accepted is a request that holder may refuse (ADR-054's whole reason for two
 * axes), so a `void` cancellation would assert a compliance the contract cannot obtain.
 */
export type FulfillmentRequestResult = AcceptedFulfillmentRequest | RejectedFulfillmentRequest;

/** One work line's observed progress, as a polling holder reports it. */
export interface FulfillmentProgressLine {
  readonly workLineId: string;
  readonly fulfilledQuantity: number;
  readonly cancelledQuantity: number;
}

/**
 * What a polling holder reports about work in flight.
 *
 * **Counters, never per-line statuses** (ADR-054, DESIGN §5.2): "3 of 5 shipped" is not a
 * status, and a status axis cannot express partial fulfilment at all.
 *
 * It carries **no negotiation status**: #2399 owns the accept handshake, and a second,
 * poll-derived answer to "did they take it" would be a rival authority over the same column.
 *
 * This shape crosses **inbound** from a plugin and nothing in this slice validates it —
 * #2400 owns progress ingestion, so it is not to be read as trusted.
 */
export interface FulfillmentProgressSnapshot {
  readonly work: FulfillmentWorkRef;
  readonly externalWorkId: string | null;
  readonly lines: readonly FulfillmentProgressLine[];
  /** The HOLDER's observation instant. `null` when not reported — never `new Date()`. */
  readonly observedAt: Date | null;
}

/**
 * The allowlist, exported as DATA so it is a second place to edit.
 *
 * Adding a field to `FulfillmentRequest` without adding it here is a `tsc` error (the
 * `Exclude` guard in the spec beside this file), which is what makes widening the projection
 * handed to a plugin a deliberate act rather than an oversight.
 */
export const FULFILLMENT_REQUEST_ALLOWED_KEYS = [
  'work',
  'orderId',
  'lines',
  'shipTo',
  'deliveryMethod',
  'idempotencyKey',
] as const;

export const FULFILLMENT_REQUEST_LINE_ALLOWED_KEYS = [
  'workLineId',
  'productVariantId',
  'quantity',
] as const;

/**
 * Buyer-identifying fields that must never appear on `FulfillmentRequest` or its lines.
 *
 * A readability aid naming what this exists to keep out — **not** the guard. The allowlist
 * above is the guard, and it refuses a `street` or a `company` nobody thought to enumerate.
 * Buyer identity is not a fulfilment input: what a picker needs is the ship-to projection,
 * which `RoutingShipTo` already bounds and redacts.
 */
export const FULFILLMENT_REQUEST_FORBIDDEN_KEYS = [
  'name',
  'buyerName',
  'email',
  'buyerEmail',
  'customerEmail',
  'phone',
  'buyerPhone',
  'address',
  'billingAddress',
  'shippingAddress',
  'taxId',
  'buyerTaxId',
  'order',
  'price',
] as const;
