/**
 * Shipment Query Service Interface
 *
 * Read seam for the shipment HTTP API (#846). Exists so the API controller
 * depends on an `I*Service` rather than `ShipmentRepositoryPort` directly —
 * the `*RepositoryPort` cross-context import is banned in `apps/**`
 * (`scripts/check-cross-context-imports.mjs`). Keeps shipment persistence
 * intra-context; the controller sees only this interface.
 *
 * @module libs/core/src/shipping/application/interfaces
 */

import type { Shipment } from '../../domain/entities/shipment.entity';
import type {
  PaginatedShipments,
  ShipmentFilters,
  ShipmentPagination,
} from '../../domain/types/shipment-query.types';

export interface IShipmentQueryService {
  /** Filtered, paginated list across all orders/connections (most-recent first). */
  list(filters: ShipmentFilters, pagination: ShipmentPagination): Promise<PaginatedShipments>;

  /** Single shipment by internal id, or null when absent. */
  getById(id: string): Promise<Shipment | null>;

  /**
   * Most-recent non-terminal shipment for an order, or null. Serves the
   * order-detail "Shipment" panel from the domain's own "active" definition
   * (`TerminalShipmentStatusValues`) so the FE doesn't re-derive it.
   */
  getActiveByOrderId(orderId: string): Promise<Shipment | null>;

  /**
   * Did this order's goods already leave the building — i.e. has any of its
   * shipments claimed `Shipment.reservationConsumedAt` (#2347)?
   *
   * A DURABLE FACT, never an inference from reservation status. Asking the
   * ledger instead cannot answer it: `listHeldByOrderRecordId` returns only
   * `held` rows, so "consumed", "expired" and "never reserved" are one and the
   * same empty answer. The marker is the only thing that distinguishes them,
   * which is why the cancellation sequence (#2348) keys on it to decide not to
   * restore an order that already shipped.
   *
   * `true` when ANY shipment on the order carries the marker. Partial dispatch
   * is not modelled (`shipments` carries no line composition), so the
   * conservative reading is the one that cannot oversell.
   *
   * Folding over `findByOrderId` is DELIBERATE at today's
   * shipments-per-order cardinality — a handful of rows, already indexed by
   * `orderId`. Turning it into a repository `EXISTS` query would be a
   * `ShipmentRepositoryPort` change, which is a wider blast radius than this
   * read is worth; do not "optimise" it without noticing that cost.
   */
  hasConsumedReservations(orderId: string): Promise<boolean>;
}
