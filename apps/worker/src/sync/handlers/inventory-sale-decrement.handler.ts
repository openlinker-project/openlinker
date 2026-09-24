/**
 * Inventory Sale Decrement Handler (#3453, epic #3460)
 *
 * Handles `inventory.saleDecrement` — lower one routed work's sold quantities in
 * the product master that owns each line.
 *
 * ## Why this handler composes the inputs
 *
 * `inventory` may not import `orders` (`OrdersModule` imports `InventoryModule`)
 * and may not read `fulfillment`'s tables, so the work and the order are read
 * HERE and passed into core as arguments — the #3171 precedent. For the same
 * reason core REPORTS the order's attention verdict and this handler writes it
 * through `IOrderRecordService.markOmsAttention`.
 *
 * ## Outcome contract (ADR-007)
 *
 * | Result | Outcome |
 * |---|---|
 * | every line settled, skipped, blocked or in doubt | `ok` — each is durable on its row, and a blocked or in-doubt line is surfaced on the order, never retried |
 * | a line is `retryable` (the owner's adapter could not be built) | **throws** (retryable) — nothing crossed the boundary, so a retry is safe and re-claims exactly that line |
 * | the order record is missing | **throws** (retryable) — a read race with ingestion |
 * | the work does not exist, or the payload is malformed | `business_failure` — no retry can change it |
 * | the order was cancelled before the job ran | `ok`, nothing lowered — there is no sale to account for |
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  FULFILLMENT_WORK_QUERY_SERVICE_TOKEN,
  type IFulfillmentWorkQueryService,
} from '@openlinker/core/fulfillment';
import {
  INVENTORY_SALE_DECREMENT_SERVICE_TOKEN,
  type IInventorySaleDecrementService,
  type SaleDecrementAttention,
  type SaleDecrementLineInput,
} from '@openlinker/core/inventory';
import { ORDER_RECORD_SERVICE_TOKEN, type IOrderRecordService } from '@openlinker/core/orders';
import type {
  InventorySaleDecrementPayloadV1,
  SyncJob,
  SyncJobHandler,
  SyncJobHandlerResult,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class InventorySaleDecrementHandler implements SyncJobHandler {
  private readonly logger = new Logger(InventorySaleDecrementHandler.name);

  constructor(
    @Inject(INVENTORY_SALE_DECREMENT_SERVICE_TOKEN)
    private readonly saleDecrements: IInventorySaleDecrementService,
    @Inject(FULFILLMENT_WORK_QUERY_SERVICE_TOKEN)
    private readonly works: IFulfillmentWorkQueryService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.validatePayload(job);
    if (payload === null) return { outcome: 'business_failure' };

    const work = await this.works.findWorkById(payload.workId);
    if (work === null) {
      this.logger.error(
        `inventory.saleDecrement: work not found: workId=${payload.workId} orderId=${payload.orderId}`
      );
      return { outcome: 'business_failure' };
    }

    // The WORK is the authority on which order it belongs to, never the payload.
    const record = await this.orderRecords.getOrderRecord(work.orderId);
    if (record === null) {
      throw this.retryable(job, `order record not found: orderId=${work.orderId}`);
    }

    if (record.isCancelled) {
      // Cancelled before the stock was lowered: there is no sale to account for.
      // Giving stock BACK after a decrement is #3479's, not this job's.
      this.logger.log(
        `inventory.saleDecrement: order ${work.orderId} is cancelled; lowering nothing ` +
          `for workId=${work.id}`
      );
      return { outcome: 'ok' };
    }

    const itemsById = new Map(record.orderItems.map((item) => [item.id, item]));
    const lines: SaleDecrementLineInput[] = [];
    for (const line of work.lines) {
      const quantity = line.totalQuantity - line.cancelledQuantity;
      if (quantity <= 0) continue;

      const item = itemsById.get(line.orderLineId);
      if (item === undefined) {
        // The order snapshot no longer carries the line the work was routed for.
        // Nothing can be lowered without its product; logged loudly so it is not
        // mistaken for a successful decrement.
        this.logger.error(
          `inventory.saleDecrement: order line ${line.orderLineId} of workId=${work.id} ` +
            `is missing from order ${work.orderId}; its stock was NOT lowered`
        );
        continue;
      }

      lines.push({
        orderLineId: line.orderLineId,
        productId: item.productId,
        // Routing falls back to the product id when a line carries no variant
        // (`OrderIngestionService.projectOrderForRouting`); that is a
        // product-level line, not a variant.
        productVariantId:
          line.productVariantId === item.productId ? null : line.productVariantId,
        quantity,
      });
    }

    const result = await this.saleDecrements.decrementForWork({
      orderId: work.orderId,
      workId: work.id,
      orderSourceConnectionId: record.sourceConnectionId,
      locationId: work.locationId,
      lines,
    });

    await this.writeAttention(work.orderId, result.attention);

    if (result.retryableLineIds.length > 0) {
      throw this.retryable(
        job,
        `the product master could not be reached before the write for ` +
          `line(s) [${result.retryableLineIds.join(',')}] of workId=${work.id}; retrying`
      );
    }

    return { outcome: 'ok' };
  }

  /**
   * Persist the order's SD-B state. Best-effort: the decrement outcomes are
   * already durable on their rows, and the next run recomputes the same verdict
   * from all of them (level-triggered, #2100), so a failed write here must not
   * fail the job and send it back across the boundary.
   */
  private async writeAttention(orderId: string, attention: SaleDecrementAttention): Promise<void> {
    try {
      await this.orderRecords.markOmsAttention(
        orderId,
        'sale-decrement',
        attention.kind === 'none'
          ? { kind: 'none' }
          : { kind: 'blocked', reason: 'stock-decrement-blocked', detail: attention.detail }
      );
    } catch (error) {
      this.logger.error(
        `Could not write the stock-decrement attention state for order ${orderId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private retryable(job: SyncJob, message: string): SyncJobExecutionError {
    return new SyncJobExecutionError(
      `inventory.saleDecrement: ${message}`,
      job.id,
      job.jobType,
      job.connectionId
    );
  }

  private validatePayload(job: SyncJob): InventorySaleDecrementPayloadV1 | null {
    const payload = job.payload as Partial<InventorySaleDecrementPayloadV1> | undefined;
    const workId = payload?.workId;
    const orderId = payload?.orderId;

    if (
      typeof workId !== 'string' ||
      workId.length === 0 ||
      typeof orderId !== 'string' ||
      orderId.length === 0
    ) {
      this.logger.error(`inventory.saleDecrement: invalid payload for job ${job.id}`);
      return null;
    }

    return { schemaVersion: 1, workId, orderId };
  }
}
