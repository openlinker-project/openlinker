/**
 * Fulfillment Order Cancellation Service (#3540)
 *
 * @module libs/core/src/fulfillment/application/services
 * @implements {IFulfillmentOrderCancellationService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

import { FULFILLMENT_WORK_REPOSITORY_TOKEN } from '../../fulfillment.tokens';
import { FulfillmentWorkRepositoryPort } from '../../domain/ports/fulfillment-work-repository.port';
import { isTerminalFulfillmentWorkStatus } from '../../domain/types/fulfillment-supported-actions.types';
import type {
  IFulfillmentOrderCancellationService,
  OrderWorkCancellationResult,
  OrderWorkSummary,
} from '../interfaces/fulfillment-order-cancellation.service.interface';

@Injectable()
export class FulfillmentOrderCancellationService implements IFulfillmentOrderCancellationService {
  private readonly logger = new Logger(FulfillmentOrderCancellationService.name);

  constructor(
    @Inject(FULFILLMENT_WORK_REPOSITORY_TOKEN)
    private readonly works: FulfillmentWorkRepositoryPort
  ) {}

  async summarizeForOrder(orderId: string): Promise<readonly OrderWorkSummary[]> {
    const works = await this.works.findByOrderId(orderId);
    return works.map((work) => ({
      workId: work.id,
      status: work.status,
      requestStatus: work.requestStatus,
      assignedConnectionId: work.assignedConnectionId,
    }));
  }

  async cancelAllForOrder(orderId: string, cancelledAt: Date): Promise<OrderWorkCancellationResult> {
    const works = await this.works.findByOrderId(orderId);
    const cancelledWorkIds: string[] = [];
    const skippedWorkIds: string[] = [];

    for (const work of works) {
      if (isTerminalFulfillmentWorkStatus(work.status)) {
        skippedWorkIds.push(work.id);
        continue;
      }
      // No `expectedVersion`: the order is already cancelled, so a concurrent
      // state change on the work is irrelevant - the end state is `cancelled`
      // whichever write got there first. The guarded UPDATE still refuses a work
      // that went terminal in the meantime.
      const applied = await this.works.cancel({
        workId: work.id,
        reason: 'order_cancelled',
        cancelledAt,
      });
      (applied ? cancelledWorkIds : skippedWorkIds).push(work.id);
    }

    if (cancelledWorkIds.length > 0) {
      this.logger.log(
        `Cancelled ${String(cancelledWorkIds.length)} fulfilment work object(s) for cancelled order ${orderId}`
      );
    }
    return { cancelledWorkIds, skippedWorkIds };
  }
}
