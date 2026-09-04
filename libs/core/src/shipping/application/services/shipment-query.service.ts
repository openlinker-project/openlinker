/**
 * Shipment Query Service
 *
 * Read seam for the shipment HTTP API (#846). Thin delegation to
 * `ShipmentRepositoryPort` (list / by-id / active-by-order).
 *
 * NOTE: this service exists deliberately to keep the API controller off
 * `ShipmentRepositoryPort` — the `*RepositoryPort` cross-context import is
 * banned in `apps/**` (`scripts/check-cross-context-imports.mjs`). Do NOT
 * "simplify" by injecting the repository into the controller directly; that
 * reintroduces the boundary violation. The indirection is the point.
 *
 * @module libs/core/src/shipping/application/services
 * @implements {IShipmentQueryService}
 */

import { Inject, Injectable } from '@nestjs/common';

import type { IShipmentQueryService } from '../interfaces/shipment-query.service.interface';
import type { Shipment } from '../../domain/entities/shipment.entity';
import { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import type { ShipmentDirection } from '../../domain/types/shipment-direction.types';
import type {
  PaginatedShipments,
  ShipmentFilters,
  ShipmentPagination,
} from '../../domain/types/shipment-query.types';
import { SHIPMENT_REPOSITORY_TOKEN } from '../../shipping.tokens';

@Injectable()
export class ShipmentQueryService implements IShipmentQueryService {
  constructor(
    @Inject(SHIPMENT_REPOSITORY_TOKEN)
    private readonly shipments: ShipmentRepositoryPort,
  ) {}

  async list(filters: ShipmentFilters, pagination: ShipmentPagination): Promise<PaginatedShipments> {
    return this.shipments.findMany(filters, pagination);
  }

  async getById(id: string): Promise<Shipment | null> {
    return this.shipments.findById(id);
  }

  async getActiveByOrderId(orderId: string): Promise<Shipment | null> {
    // Outbound only (#2373) — this backs the order-detail "Shipment" panel.
    return this.shipments.findActiveByOrderId(orderId, 'outbound');
  }

  /**
   * The contract — batching, the absent-vs-empty convention and why `direction`
   * is required — is documented once on
   * {@link IShipmentQueryService.findByFulfillmentWorkIds}.
   */
  async findByFulfillmentWorkIds(
    workIds: readonly string[],
    direction: ShipmentDirection,
  ): Promise<Map<string, Shipment[]>> {
    const byWork = new Map<string, Shipment[]>();
    const shipments = await this.shipments.findByFulfillmentWorkIds(workIds, direction);
    for (const shipment of shipments) {
      // Non-null by construction: the repository filtered on `IN (workIds)`, so
      // an unlinked row cannot be in this result.
      const workId = shipment.fulfillmentWorkId;
      if (workId === null) continue;
      const bucket = byWork.get(workId);
      if (bucket === undefined) byWork.set(workId, [shipment]);
      else bucket.push(shipment);
    }
    return byWork;
  }

  /**
   * The contract — why the marker and not the ledger, why ANY shipment, and why
   * the fold rather than a repository `EXISTS` — is documented once on
   * {@link IShipmentQueryService.hasConsumedReservations}.
   */
  async hasConsumedReservations(orderId: string): Promise<boolean> {
    // Outbound only (#2373). Reservation consumption is an outbound concept —
    // a return label brings goods back and never consumes a hold — and since
    // #2373 an inbound row shares this table, so an unscoped read would fold
    // over a cohort that can never carry the marker.
    const shipments = await this.shipments.findByOrderId(orderId, 'outbound');
    return shipments.some((shipment) => shipment.reservationConsumedAt !== null);
  }
}
