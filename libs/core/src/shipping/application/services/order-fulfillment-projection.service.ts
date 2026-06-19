/**
 * Order Fulfillment Projection Service
 *
 * Derives a per-order fulfillment rollup (#1108) from the order's shipments and
 * pushes it onto the orders context via `IOrderRecordService.updateFulfillmentState`.
 * Called by the shipment-mutation services after any status change, and by the
 * branch-1 fulfillment-status poll as a reconciliation backstop, so the orders
 * list reflects "has this shipped?" without a cross-context query.
 *
 * Best-effort by design: the rollup is a denormalized read-optimisation, never a
 * source of truth — a projection failure is logged and swallowed so it can never
 * fail the shipment operation that triggered it (the poll backstop heals drift).
 *
 * @module libs/core/src/shipping/application/services
 * @implements {IOrderFulfillmentProjectionService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  type IOrderRecordService,
  ORDER_RECORD_SERVICE_TOKEN,
} from '@openlinker/core/orders';

import type { IOrderFulfillmentProjectionService } from '../interfaces/order-fulfillment-projection.service.interface';
import { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import { deriveFulfillmentRollup } from '../../domain/fulfillment-rollup';
import { SHIPMENT_REPOSITORY_TOKEN } from '../../shipping.tokens';

@Injectable()
export class OrderFulfillmentProjectionService implements IOrderFulfillmentProjectionService {
  private readonly logger = new Logger(OrderFulfillmentProjectionService.name);

  constructor(
    @Inject(SHIPMENT_REPOSITORY_TOKEN)
    private readonly shipments: ShipmentRepositoryPort,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
  ) {}

  async recompute(orderId: string): Promise<void> {
    try {
      const shipments = await this.shipments.findByOrderId(orderId);
      const rollup = deriveFulfillmentRollup(shipments.map((s) => s.status));
      await this.orderRecords.updateFulfillmentState(orderId, rollup);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Fulfillment-rollup projection failed for order ${orderId}: ${message}`);
    }
  }
}
