/**
 * Fulfillment Sale-Decrement Reconcile Service (#3629)
 *
 * Reads one page of routed works whose `inventory.saleDecrement` job was never
 * enqueued. Injects the work repository and nothing else - see
 * {@link IFulfillmentSaleDecrementReconcileService}.
 *
 * @module libs/core/src/fulfillment/application/services
 * @implements {IFulfillmentSaleDecrementReconcileService}
 */
import { Inject, Injectable } from '@nestjs/common';

import { FulfillmentWorkRepositoryPort } from '../../domain/ports/fulfillment-work-repository.port';
import { buildSaleDecrementJobDedupeKey } from '../../domain/types/fulfillment-sale-decrement-enqueue.types';
import { FULFILLMENT_WORK_REPOSITORY_TOKEN } from '../../fulfillment.tokens';
import type { IFulfillmentSaleDecrementReconcileService } from '../interfaces/fulfillment-sale-decrement-reconcile.service.interface';
import type {
  ListWorksMissingSaleDecrementJobInput,
  ListWorksMissingSaleDecrementJobResult,
} from '../types/fulfillment-sale-decrement-reconcile-sweep.types';

@Injectable()
export class FulfillmentSaleDecrementReconcileService
  implements IFulfillmentSaleDecrementReconcileService
{
  constructor(
    @Inject(FULFILLMENT_WORK_REPOSITORY_TOKEN)
    private readonly repository: FulfillmentWorkRepositoryPort
  ) {}

  async listWorksMissingSaleDecrementJob(
    input: ListWorksMissingSaleDecrementJobInput
  ): Promise<ListWorksMissingSaleDecrementJobResult> {
    const rows = await this.repository.listWorksMissingSaleDecrementJob({
      createdBefore: new Date(input.now.getTime() - input.graceMs),
      createdAfter: new Date(input.now.getTime() - input.lookbackMs),
      limit: input.limit,
    });

    return {
      candidates: rows.map((row) => ({
        workId: row.workId,
        orderId: row.orderId,
        connectionId: row.orderSourceConnectionId,
        // The producers' own key, so a race with a slow original enqueue is a
        // harmless `isExisting`.
        dedupeKey: buildSaleDecrementJobDedupeKey(row.workId),
      })),
    };
  }
}
