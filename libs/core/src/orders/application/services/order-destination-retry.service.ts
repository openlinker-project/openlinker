/**
 * Order Destination Retry Service
 *
 * Operator-driven retry for a failed destination sync. Re-enqueues the
 * source-side `marketplace.order.sync` job with a fresh idempotency key
 * (the original key would still match the now-dead job and short-circuit).
 *
 * Concurrency model: claim-then-enqueue. The destination's sync-status row
 * is flipped from `failed` → `pending` *before* enqueue, acting as the
 * de-facto lock. A concurrent click reads `pending` and 409s. On enqueue
 * failure, the row is reverted to `failed` with the original error preserved.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderDestinationRetryService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { IIdentifierMappingService, IDENTIFIER_MAPPING_SERVICE_TOKEN, CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { JobEnqueuePort, JOB_ENQUEUE_TOKEN, type SyncJobRequest } from '@openlinker/core/sync';
import type {
  IOrderDestinationRetryService,
  OrderDestinationRetryInput,
  OrderDestinationRetryResult,
} from '../interfaces/order-destination-retry.service.interface';
import { IOrderRecordService } from '../interfaces/order-record.service.interface';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { OrderRecordNotFoundException } from '../../domain/exceptions/order-record-not-found.exception';
import { OrderDestinationNotFoundException } from '../../domain/exceptions/order-destination-not-found.exception';
import { OrderDestinationNotRetryableException } from '../../domain/exceptions/order-destination-not-retryable.exception';
import { MissingSourceExternalIdException } from '../../domain/exceptions/missing-source-external-id.exception';
import { ORDER_RECORD_REPOSITORY_TOKEN, ORDER_RECORD_SERVICE_TOKEN } from '../../orders.tokens';

@Injectable()
export class OrderDestinationRetryService implements IOrderDestinationRetryService {
  private readonly logger = new Logger(OrderDestinationRetryService.name);

  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly orderRecordRepository: OrderRecordRepositoryPort,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort
  ) {}

  async retry(input: OrderDestinationRetryInput): Promise<OrderDestinationRetryResult> {
    const { internalOrderId, destinationConnectionId } = input;

    this.logger.log(
      `Operator retry requested: order=${internalOrderId} destination=${destinationConnectionId}`
    );

    const order = await this.orderRecordRepository.findById(internalOrderId);
    if (!order) {
      throw new OrderRecordNotFoundException(internalOrderId);
    }

    const destinationRow = order.syncStatus.find(
      (s) => s.destinationConnectionId === destinationConnectionId
    );
    if (!destinationRow) {
      throw new OrderDestinationNotFoundException(internalOrderId, destinationConnectionId);
    }

    if (destinationRow.status !== 'failed') {
      throw new OrderDestinationNotRetryableException(
        internalOrderId,
        destinationConnectionId,
        destinationRow.status
      );
    }

    const sourceExternalIds = await this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Order, internalOrderId);
    const sourceMapping = sourceExternalIds.find(
      (m) => m.connectionId === order.sourceConnectionId
    );
    if (!sourceMapping) {
      throw new MissingSourceExternalIdException(internalOrderId, order.sourceConnectionId);
    }

    // Snapshot the original failure so we can revert with it on enqueue failure.
    const originalError = destinationRow.error;

    // Claim the slot: flip failed → pending. From here a concurrent click 409s.
    await this.orderRecordService.updateSyncStatus(internalOrderId, destinationConnectionId, {
      destinationConnectionId,
      status: 'pending',
    });

    const idempotencyKey = `marketplace:${order.sourceConnectionId}:order:${order.sourceEventId ?? internalOrderId}:retry:${Date.now()}`;

    const jobRequest: SyncJobRequest = {
      jobType: 'marketplace.order.sync',
      connectionId: order.sourceConnectionId,
      payload: {
        schemaVersion: 1,
        externalOrderId: sourceMapping.externalId,
        sourceEventId: order.sourceEventId ?? undefined,
      },
      idempotencyKey,
    };

    try {
      const { jobId } = await this.jobEnqueue.enqueueJob(jobRequest);
      this.logger.log(
        `Retry enqueued: jobId=${jobId} order=${internalOrderId} destination=${destinationConnectionId} sourceConnection=${order.sourceConnectionId}`
      );
      return { jobId, jobType: 'marketplace.order.sync' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Retry enqueue failed; reverting destination back to 'failed'. order=${internalOrderId} destination=${destinationConnectionId}: ${message}`,
        error instanceof Error ? error.stack : undefined
      );
      // Revert: restore failed state with the original error preserved. If the revert
      // *itself* throws (rare DB blip between claim and revert), the row is left in
      // `pending` and the operator can no longer click Retry on it — log loudly so
      // someone notices and can flip the row by hand.
      try {
        await this.orderRecordService.updateSyncStatus(internalOrderId, destinationConnectionId, {
          destinationConnectionId,
          status: 'failed',
          error: originalError,
        });
      } catch (revertError) {
        const revertMessage =
          revertError instanceof Error ? revertError.message : String(revertError);
        this.logger.error(
          `Revert to 'failed' also failed; destination row stuck in 'pending'. order=${internalOrderId} destination=${destinationConnectionId}: ${revertMessage}`,
          revertError instanceof Error ? revertError.stack : undefined
        );
      }
      throw error;
    }
  }
}
