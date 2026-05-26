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
    return this.shipments.findActiveByOrderId(orderId);
  }
}
