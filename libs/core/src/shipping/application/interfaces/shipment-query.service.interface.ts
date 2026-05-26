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
}
