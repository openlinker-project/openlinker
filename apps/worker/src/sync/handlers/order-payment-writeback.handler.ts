/**
 * Order Payment Writeback Handler (#3963)
 *
 * Runs ONE send attempt of `order.paymentWriteback.push`: tells one destination
 * shop that an order it holds as unpaid has since been paid at the source.
 * `job.connectionId` is the destination; the source travels in the payload
 * because the relay excludes it as the event's origin.
 *
 * Retries ride the runner's own ladder: while the shop keeps failing
 * transiently the handler throws, and on the LAST attempt the service records
 * `not-sent` instead, so the order shows the problem and the job ends `ok`
 * rather than dead. A payment that can never be sent (cash on delivery,
 * cancelled, refunded, a shop refusal) is recorded and ends `ok` at once.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  PAYMENT_WRITEBACK_SERVICE_TOKEN,
  type IPaymentWritebackService,
} from '@openlinker/core/orders';
import {
  SyncJobExecutionError,
  type OrderPaymentWritebackPushPayloadV1,
  type SyncJob,
  type SyncJobHandler,
  type SyncJobHandlerResult,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class OrderPaymentWritebackHandler implements SyncJobHandler {
  private readonly logger = new Logger(OrderPaymentWritebackHandler.name);

  constructor(
    @Inject(PAYMENT_WRITEBACK_SERVICE_TOKEN)
    private readonly paymentWriteback: IPaymentWritebackService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);
    // `attempts` counts the attempts already made, so this run is attempt + 1.
    const isLastAttempt = job.attempts + 1 >= job.maxAttempts;

    const outcome = await this.paymentWriteback.push({
      internalOrderId: payload.internalOrderId,
      destinationConnectionId: job.connectionId,
      sourceConnectionId: payload.sourceConnectionId,
      isLastAttempt,
    });

    if (outcome === 'retrying') {
      throw new SyncJobExecutionError(
        `Payment not yet accepted by shop ${job.connectionId} for order ${payload.internalOrderId}; retrying`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    this.logger.log(
      `order.paymentWriteback.push job ${job.id}: order ${payload.internalOrderId} -> ${job.connectionId} ${outcome}`
    );
    return { outcome: 'ok' };
  }

  private getPayload(job: SyncJob): OrderPaymentWritebackPushPayloadV1 {
    const payload = job.payload as unknown as Partial<OrderPaymentWritebackPushPayloadV1>;
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.internalOrderId !== 'string' ||
      typeof payload.sourceConnectionId !== 'string'
    ) {
      throw new SyncJobExecutionError(
        `Missing or invalid payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    return {
      schemaVersion: 1,
      internalOrderId: payload.internalOrderId,
      sourceConnectionId: payload.sourceConnectionId,
    };
  }
}
