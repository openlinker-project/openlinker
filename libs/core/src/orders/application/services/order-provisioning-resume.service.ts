/**
 * Order Provisioning Resume Service (#2341)
 *
 * Re-enqueues the source-side `marketplace.order.sync` for one order after a
 * hold that was suppressing its provisioning is released.
 *
 * **This service never throws for a modelled condition** — every modelled
 * failure leaves by {@link OrderProvisioningResumeResult}, and its spec asserts
 * it. The rationale for that, for the code-not-message failure arm, and for the
 * `skipped`/`failed` split lives in the interface docblock rather than being
 * restated here.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderProvisioningResumeService}
 * @see {@link IOrderProvisioningResumeService} for the contract and its four
 *   load-bearing properties
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  CORE_ENTITY_TYPE,
} from '@openlinker/core/identifier-mapping';
import {
  JobEnqueuePort,
  JOB_ENQUEUE_TOKEN,
  type SyncJobRequest,
} from '@openlinker/core/sync';
import type {
  IOrderProvisioningResumeService,
  OrderProvisioningResumeResult,
} from '../interfaces/order-provisioning-resume.service.interface';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '../../orders.tokens';

@Injectable()
export class OrderProvisioningResumeService
  implements IOrderProvisioningResumeService
{
  private readonly logger = new Logger(OrderProvisioningResumeService.name);

  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly orderRecordRepository: OrderRecordRepositoryPort,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort
  ) {}

  async resume(
    internalOrderId: string
  ): Promise<OrderProvisioningResumeResult> {
    const order = await this.orderRecordRepository.findById(internalOrderId);
    if (!order) {
      return { status: 'skipped', reason: 'order-not-found' };
    }

    const sourceExternalIds = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Order,
      internalOrderId
    );
    const sourceMapping = sourceExternalIds.find(
      (mapping) => mapping.connectionId === order.sourceConnectionId
    );
    if (!sourceMapping) {
      // An operator-authored or not-yet-mapped record has no source-side job to
      // enqueue at all. Healthy, not failed.
      return { status: 'skipped', reason: 'missing-source-external-id' };
    }

    // Wave-distinct, mirroring `OrderDestinationRetryService`: the original
    // submit's key is long dead and would silently dedup against it. Its own
    // `hold-release` namespace (rather than reusing `:retry:`) keeps a release
    // and an operator retry legible apart in `sync_jobs`.
    const idempotencyKey = `marketplace:${order.sourceConnectionId}:order:${
      order.sourceEventId ?? internalOrderId
    }:hold-release:${Date.now()}`;

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
        `Provisioning resumed after hold release: jobId=${jobId} order=${internalOrderId} sourceConnection=${order.sourceConnectionId}`
      );
      return { status: 'enqueued', jobId, jobType: 'marketplace.order.sync' };
    } catch (error) {
      // The message is logged, never returned — see interface property 3.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Provisioning resume enqueue failed after hold release; the hold IS released and the order stays un-provisioned until an operator retries its destination. order=${internalOrderId} sourceConnection=${order.sourceConnectionId}: ${message}`,
        error instanceof Error ? error.stack : undefined
      );
      return { status: 'failed', reason: 'enqueue-failed' };
    }
  }
}
