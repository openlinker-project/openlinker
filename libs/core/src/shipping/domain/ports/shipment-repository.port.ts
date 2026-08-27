/**
 * Shipment Repository Port
 *
 * Persistence contract for `Shipment` aggregates. Shaped for the append-
 * only multiplicity model (1 order → N shipments over time): order-scoped
 * queries return arrays, with a dedicated `findActiveByOrderId` returning
 * the most-recent non-terminal row for the order-detail panel.
 *
 * Implemented by `ShipmentRepository` in
 * `libs/core/src/shipping/infrastructure/persistence/repositories/`.
 *
 * Domain-only — zero framework imports.
 *
 * @module libs/core/src/shipping/domain/ports
 */

import type { Shipment } from '../entities/shipment.entity';
import type { ShipmentDirection } from '../types/shipment-direction.types';
import type {
  PaginatedShipments,
  ShipmentFilters,
  ShipmentPagination,
} from '../types/shipment-query.types';
import type {
  CreateShipmentInput,
  UpdateShipmentInput,
} from '../types/shipment.types';

export interface ShipmentRepositoryPort {
  /**
   * Insert a new shipment in `draft` status. The repository generates the
   * `ol_shipment_*` id via `formatInternalId('Shipment')` before
   * persisting. All terminal-state timestamps + tracking fields are
   * initialised to `null`.
   */
  create(input: CreateShipmentInput): Promise<Shipment>;

  /**
   * Filtered, paginated list across all orders/connections, ordered by
   * `createdAt DESC`. Filters combine with AND; `total` is the unpaginated
   * match count. Backs the `/shipments` read API (#846).
   */
  findMany(filters: ShipmentFilters, pagination: ShipmentPagination): Promise<PaginatedShipments>;

  findById(id: string): Promise<Shipment | null>;

  /**
   * All shipments for an order IN ONE DIRECTION, ordered by `createdAt ASC`.
   * Returns `[]` when the order has no shipments in that cohort. Multiple rows
   * happen on AC-7 cancel + re-issue (and on future multi-package shipments).
   *
   * `direction` is REQUIRED and deliberately not defaulted (#2373). A default
   * is a silent decline: a later call site would read the outbound cohort
   * while believing it read every shipment, and nothing would say otherwise.
   * Required, it is a compile error to omit — the same reasoning that widened
   * `SalesDocumentOrderFacts.buyerHasTaxId` to `boolean | undefined` rather
   * than defaulting it. Do not "simplify" this back to an optional parameter.
   */
  findByOrderId(orderId: string, direction: ShipmentDirection): Promise<readonly Shipment[]>;

  /**
   * Most-recent non-terminal shipment for an order IN ONE DIRECTION, or null
   * if every row in that cohort is terminal (`delivered` / `failed` /
   * `cancelled`) or none exists. This is the row the order-detail "Shipment"
   * panel renders, and the dispatch-claim read.
   *
   * `direction` is REQUIRED for the reason given on `findByOrderId` above — an
   * outbound dispatch must not be blocked by an in-flight return label, nor
   * the reverse.
   */
  findActiveByOrderId(orderId: string, direction: ShipmentDirection): Promise<Shipment | null>;

  findByProviderShipmentId(providerShipmentId: string): Promise<Shipment | null>;

  /**
   * Branch-1 (#834) idempotency gate. Returns the existing branch-1
   * Shipment for `(orderId, connectionId)` if one is already projected,
   * or `null` to greenlight `create()`. Matches the persisted-shape
   * predicate `orderId = ? AND connectionId = ? AND direction = ? AND
   * providerShipmentId IS NULL` — the same key the partial-unique index
   * `UQ_shipments_branch_one_per_order_conn` enforces at the DB (#2373 added
   * `direction` to that index's KEY columns, so the lookup must carry it too
   * or it would match a sibling row the index deliberately permits).
   *
   * `direction` is REQUIRED for the reason given on `findByOrderId` above.
   *
   * Returns `null` when the order has only non-null-`providerShipmentId`
   * rows (branches 2/3 — the order is being shipped by InPost / Allegro
   * Delivery, not the OMP), so the sync service can skip branch-1
   * projection for non-branch-1 orders even before checking the routing
   * resolution.
   */
  findBranchOneByOrderAndConnection(
    orderId: string,
    connectionId: string,
    direction: ShipmentDirection,
  ): Promise<Shipment | null>;

  /**
   * Apply a partial patch. Throws `ShipmentNotFoundException` when no
   * row matches `id`. Only fields present on the patch are written;
   * unspecified fields stay untouched.
   */
  update(id: string, patch: UpdateShipmentInput): Promise<Shipment>;

  /**
   * Atomically claim the right to relay this shipment's waybill to the order's
   * SOURCE participant (#1947). Stamps `waybillRelayedAt` only if it is still
   * NULL, and reports whether THIS caller won.
   *
   * The conditional write is the serialization point between the two unlocked
   * triggers that both observe the same `trackingNumber` null→value transition:
   * the status-sync poll and the carrier webhook. Without it, both would relay
   * and the source would receive two waybill writes.
   *
   * Claim BEFORE relaying, then {@link releaseWaybillRelay} on failure —
   * mirroring the webhook dedup gate, which inserts its row up front and
   * deletes it when downstream publishing fails so a retry can re-enter the
   * gate. Claiming after a successful relay would leave the race open.
   *
   * @returns `true` when the claim was won (caller must relay), `false` when
   *          another caller already holds it or the row does not exist.
   */
  claimWaybillRelay(id: string, at: Date): Promise<boolean>;

  /**
   * Release a claim taken by {@link claimWaybillRelay} so a later tick can
   * retry. Idempotent: releasing an already-released row is a no-op.
   */
  releaseWaybillRelay(id: string): Promise<void>;
}
