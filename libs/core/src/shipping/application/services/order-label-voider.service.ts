/**
 * Order Label Voider Service (#3540, case 4a)
 *
 * The shipping-side implementation of the orders context's
 * {@link OrderLabelVoiderPort}: when the sales channel cancels an order, void the
 * labels OpenLinker bought for it. Reuses {@link IShipmentCancellationService},
 * the same void the operator cancel path calls.
 *
 * Only drafted and generated labels are voided - past that the parcel is with the
 * carrier and a void is no longer clean. Best-effort: one failure is reported and
 * the other labels are still tried.
 *
 * @module libs/core/src/shipping/application/services
 * @implements {OrderLabelVoiderPort}
 */
import { Inject, Injectable } from '@nestjs/common';
import type { OrderLabelVoiderPort, OrderLabelVoidOutcome } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';
import { SHIPMENT_STATUS } from '../../domain/types/shipment-status.types';
import {
  SHIPMENT_CANCELLATION_SERVICE_TOKEN,
  SHIPMENT_QUERY_SERVICE_TOKEN,
} from '../../shipping.tokens';
import { IShipmentCancellationService } from '../interfaces/shipment-cancellation.service.interface';
import { IShipmentQueryService } from '../interfaces/shipment-query.service.interface';

const VOIDABLE_STATUSES: readonly string[] = [SHIPMENT_STATUS.Draft, SHIPMENT_STATUS.Generated];

@Injectable()
export class OrderLabelVoiderService implements OrderLabelVoiderPort {
  private readonly logger = new Logger(OrderLabelVoiderService.name);

  constructor(
    @Inject(SHIPMENT_QUERY_SERVICE_TOKEN)
    private readonly shipmentQuery: IShipmentQueryService,
    @Inject(SHIPMENT_CANCELLATION_SERVICE_TOKEN)
    private readonly shipmentCancellation: IShipmentCancellationService
  ) {}

  async voidLabelsForOrder(internalOrderId: string): Promise<readonly OrderLabelVoidOutcome[]> {
    const shipments = await this.shipmentQuery.getOutboundByOrderId(internalOrderId);
    const outcomes: OrderLabelVoidOutcome[] = [];
    for (const shipment of shipments) {
      if (!VOIDABLE_STATUSES.includes(shipment.status)) continue;
      try {
        await this.shipmentCancellation.cancel(shipment.id);
        outcomes.push({ shipmentId: shipment.id, outcome: 'voided' });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `order_label_void_failed order=${internalOrderId} shipment=${shipment.id}: ${detail}`
        );
        outcomes.push({ shipmentId: shipment.id, outcome: 'failed', detail });
      }
    }
    return outcomes;
  }
}
