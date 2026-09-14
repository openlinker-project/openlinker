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
 * Since #2727 this is also the ONE seam that writes the line-grain shipment read
 * model, because it is already called from all eight shipment-mutation sites —
 * so no mutation service needed changing. It is NOT unconditional: three of
 * those sites sit behind a `if (patch.status)` changed-patch gate, so a
 * tracking-only backfill (#1947) or a `labelPdfRef` write creates no missing
 * line rows. That is the same gate that produced #2402's permanently-unlinkable
 * branch-1 row, and it is recorded here rather than asserted away. The dispatch
 * path — where a line first needs to exist — always calls `recompute`.
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
import { IShipmentLineService } from '../interfaces/shipment-line.service.interface';
import { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import { deriveFulfillmentRollup } from '../../domain/fulfillment-rollup';
import { SHIPMENT_LINE_SERVICE_TOKEN, SHIPMENT_REPOSITORY_TOKEN } from '../../shipping.tokens';

@Injectable()
export class OrderFulfillmentProjectionService implements IOrderFulfillmentProjectionService {
  private readonly logger = new Logger(OrderFulfillmentProjectionService.name);

  constructor(
    @Inject(SHIPMENT_REPOSITORY_TOKEN)
    private readonly shipments: ShipmentRepositoryPort,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(SHIPMENT_LINE_SERVICE_TOKEN)
    private readonly shipmentLines: IShipmentLineService,
  ) {}

  async recompute(orderId: string): Promise<void> {
    try {
      // Outbound only (#2373): this projection is a statement about
      // fulfilling the buyer's order, so a return label is a different cohort
      // and must not contribute to its rollup.
      const shipments = await this.shipments.findByOrderId(orderId, 'outbound');
      // #2727: bring the line-grain read model into step with these shipments,
      // then roll up. `reconcile` is handed the shipments ALREADY loaded above
      // rather than re-reading them — this method is called once per shipment
      // inside the two status-sync loops, so a `reconcile(orderId)` that
      // re-queried would be O(S² × I) upserts for a page touching S shipments
      // of one order.
      //
      // Its `undefined` means "no line data" (pre-backfill, or a snapshot with
      // no items) and is passed straight through, because
      // `deriveFulfillmentRollup` must distinguish that from "zero delivered".
      const coverage = await this.shipmentLines.reconcile(orderId, shipments);
      const rollup = deriveFulfillmentRollup(
        shipments.map((s) => s.status),
        coverage,
      );
      await this.orderRecords.updateFulfillmentState(orderId, rollup);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Fulfillment-rollup projection failed for order ${orderId}: ${message}`);
    }
  }
}
