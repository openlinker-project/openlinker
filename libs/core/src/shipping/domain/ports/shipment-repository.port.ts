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

  findById(id: string): Promise<Shipment | null>;

  /**
   * All shipments for an order, ordered by `createdAt ASC`. Returns `[]`
   * when the order has no shipments yet. Multiple rows happen on AC-7
   * cancel + re-issue (and on future multi-package shipments).
   */
  findByOrderId(orderId: string): Promise<readonly Shipment[]>;

  /**
   * Most-recent non-terminal shipment for an order, or null if every row
   * is terminal (`delivered` / `failed` / `cancelled`) or no shipments
   * exist. This is the row the order-detail "Shipment" panel renders.
   */
  findActiveByOrderId(orderId: string): Promise<Shipment | null>;

  findByProviderShipmentId(providerShipmentId: string): Promise<Shipment | null>;

  /**
   * Apply a partial patch. Throws `ShipmentNotFoundException` when no
   * row matches `id`. Only fields present on the patch are written;
   * unspecified fields stay untouched.
   */
  update(id: string, patch: UpdateShipmentInput): Promise<Shipment>;
}
