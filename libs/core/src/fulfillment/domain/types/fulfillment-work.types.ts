/**
 * Fulfillment Work — the unit of assignment (#2391, ADR-054, DESIGN §5.2)
 *
 * An order's line-quantities grouped per (location, delivery method), N per
 * order, 1:N to shipments.
 *
 * **Splits exist only at THIS grain.** OL cannot split a commercial order:
 * `identifier_mappings` is a bijection per connection (ADR-044), so a split
 * child is permanently unmappable on its origin and a marketplace cancel would
 * leave it live and shippable. So the WORK is split and the order is left
 * alone — the Shopify FulfillmentOrder answer, adopted as the only available
 * one (DESIGN §5.1).
 *
 * **Two orthogonal axes**, each in its own file beside this one: `status`
 * (execution) and `requestStatus` (negotiation). See either for why they are
 * never merged.
 *
 * ## The one authorized cross-context import
 *
 * `FulfillmentCancellationReason` is imported **type-only** from
 * `@openlinker/core/fulfillment-authority`, and is this leaf's single entry in
 * `ZERO_SIBLING_EDGE_LEAVES`. It is not restated locally because the union
 * already ships there (#2304) with per-member provenance, and two spellings of
 * one union is exactly the drift ADR-053 § Alternatives rejects. The import is
 * cycle-safe for two reasons that must BOTH hold: it is type-only (erased at
 * build time, so no runtime edge exists at all), and the target is itself a
 * registered zero-sibling-edge leaf exporting no NestJS module. See the
 * amended docblock in `libs/core/src/__tests__/barrel-purity.spec.ts`.
 *
 * @module libs/core/src/fulfillment/domain/types
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 * @see docs/architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.2
 */
import type { FulfillmentCancellationReason } from '@openlinker/core/fulfillment-authority';

import type { FulfillmentRequestStatus } from './fulfillment-request-status.types';
import type { FulfillmentWorkStatus } from './fulfillment-work-status.types';

/**
 * What an executor is handed to identify one work object.
 *
 * `connectionId` is the holder connection **at the time the ref was minted** —
 * deliberately a snapshot rather than a re-read of
 * `FulfillmentWork.assignedConnectionId`, which moves when work is re-routed
 * (`rerouted`). A vendor answering about a ref must be answering about the
 * assignment it was actually given.
 */
export interface FulfillmentWorkRef {
  readonly workId: string;
  readonly connectionId: string;
}

/**
 * One order line's participation in one work object.
 *
 * **Counters, never per-line statuses** (DESIGN §5.2): "3 of 5 shipped" is not
 * a status, and a status axis cannot express partial fulfilment at all. The
 * invariant `fulfilledQuantity + cancelledQuantity <= totalQuantity` becomes a
 * DB `CHECK` in #2392; here it is the pure `checkFulfillmentWorkLineCapacity`
 * below, so the rule exists once before the column does.
 */
export interface FulfillmentWorkLine {
  readonly id: string;
  /**
   * A BY-VALUE reference into the order snapshot's items. `order_records` has
   * no lines table, so this can never carry a foreign key — the same posture
   * `ReturnLine.resolvedOrderLineId` holds.
   */
  readonly orderLineId: string;
  readonly productVariantId: string;
  readonly totalQuantity: number;
  readonly fulfilledQuantity: number;
  readonly cancelledQuantity: number;
}

/**
 * The aggregate.
 *
 * `orderId` is a plain internal id string, never an `Order`. That is what keeps
 * ADR-053's no-injection invariant cheap: this context never needs order data
 * as a shape, so it needs neither an `orders` service nor even
 * `@openlinker/core/orders/types`.
 */
export interface FulfillmentWork {
  readonly id: string;
  readonly orderId: string;

  /**
   * The location this work is to be fulfilled from — an `inventory_locations`
   * row id (design adjudication #2: "one location identity: the
   * `inventory_locations` table"), carried as a plain string for the reason
   * above.
   *
   * `null` means **not yet assigned**, never "no location applies": the router
   * mints work before it has necessarily resolved a location, and an
   * observation-only work object on an `omp_fulfilled` topology may never
   * acquire one. Written by the router (#2395); #2392 decides the column's
   * nullability with that reading.
   */
  readonly locationId: string | null;

  /**
   * The delivery method this grouping is for. An OPAQUE key at this grain:
   * ADR-054 § Consequences keeps order-layer *sourcing* separate from the
   * shipping layer's *dispatch resolution* (ADR-012/ADR-020), which stays
   * authoritative for label mechanics, so no delivery vocabulary is restated
   * here.
   *
   * `null` means **not yet resolved**, as above. Written by the router (#2395),
   * which is the single producer — a second writer would give one grouping key
   * two spellings before #2392 puts an index on it.
   */
  readonly deliveryMethod: string | null;

  /** The holder. `null` until a router assigns one, and again after a rejection. */
  readonly assignedConnectionId: string | null;

  readonly status: FulfillmentWorkStatus;
  readonly requestStatus: FulfillmentRequestStatus;

  /**
   * A persisted, monotonic counter, incremented **only by a router-driven
   * re-request** and written before the outbound call — **never** the
   * job-runner attempt, which changes on exactly the retries the key must
   * survive (ADR-054 R1; the Amazon MCF `sellerFulfillmentOrderId` model). It
   * is what makes `FulfillmentRequest.idempotencyKey`
   * (`work:{workId}:{assignmentAttempt}`) stable across a retry.
   *
   * The FIELD is declared here because ADR-054 names it as a work-row column;
   * *when* it increments is #2399's. (It has no writer in this slice, which is
   * the asymmetry with the deferred `sku` — that one is not a declared column,
   * this one is.)
   */
  readonly assignmentAttempt: number;

  /**
   * Why the work ended, when `status` is `cancelled`. `null` otherwise.
   *
   * ADR-054 requires a force-close to land on `cancelled` "never
   * `closed`-as-completed", with reason `operator_forced` — so the reason is
   * what keeps a force-close and a completion distinguishable in the record.
   */
  readonly cancellationReason: FulfillmentCancellationReason | null;

  readonly lines: readonly FulfillmentWorkLine[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Units still to be accounted for on a line.
 *
 * Pure; the rule for the type it sits with (`engineering-standards.md` § the
 * pure-rule exception to "types only"). Deliberately NOT a method on
 * `FulfillmentWorkLine` — that shape is a readonly `interface`, so ADR-011's
 * entity-behaviour policy is not engaged; it is the reason nothing hangs off
 * the shape.
 *
 * Namespaced rather than a bare `remainingQuantity`, because this name lands on
 * the public `@openlinker/core/fulfillment` subpath.
 */
export function readFulfillmentWorkLineRemainingQuantity(line: FulfillmentWorkLine): number {
  return line.totalQuantity - line.fulfilledQuantity - line.cancelledQuantity;
}

/**
 * Whether a line satisfies `fulfilled + cancelled <= total`.
 *
 * `check*` rather than `is*` on purpose: the `is*` prefix in this repo is
 * load-bearing for **type guards** (union narrowers, capability guards), and a
 * boolean invariant predicate that narrows nothing must not wear it. Mirrors
 * `checkRequiredToSell` / `checkParameterRestrictions`.
 *
 * #2392 mirrors this as the DB `CHECK`; the two must move together.
 */
export function checkFulfillmentWorkLineCapacity(line: FulfillmentWorkLine): boolean {
  return readFulfillmentWorkLineRemainingQuantity(line) >= 0;
}
