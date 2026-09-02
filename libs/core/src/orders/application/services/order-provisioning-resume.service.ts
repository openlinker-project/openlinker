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
import { IOrderRecordService } from '../interfaces/order-record.service.interface';
import type { OrderRecord } from '../../domain/entities/order-record.entity';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { isWithheldOnHoldError } from '../../domain/types/order-hold.types';
import {
  ORDER_RECORD_REPOSITORY_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
} from '../../orders.tokens';

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
    private readonly jobEnqueue: JobEnqueuePort,
    // #2588 review I-2 — needed to strand-mark the destinations a failed
    // re-enqueue left owed. No new module edge: `OrdersModule` provides both
    // this service and `ORDER_RECORD_SERVICE_TOKEN`.
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService
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
        `Provisioning resume enqueue failed after hold release; the hold IS released and ` +
          `every destination still withheld will be marked failed so the operator retry can reach it. ` +
          `order=${internalOrderId} sourceConnection=${order.sourceConnectionId}: ${message}`,
        error instanceof Error ? error.stack : undefined
      );
      await this.strandWithheldDestinations(internalOrderId);
      return { status: 'failed', reason: 'enqueue-failed' };
    }
  }

  /**
   * Move every still-withheld destination from `pending` to `failed` after the
   * re-enqueue failed (#2588 review I-2).
   *
   * **This is what makes the documented remedy exist.** The withheld row is
   * `pending`; `OrderDestinationRetryService` refuses anything that is not
   * `failed`, `marketplace.order.sync` has no cron backstop for one order, and a
   * cursor-based journal never re-delivers the event — so before this, a missed
   * one-shot `failed` response left the order at `pending` forever, visually
   * indistinguishable from healthy in-flight, and never reaching the shop.
   * `failed` is also the honest state: something broke, and retrying is exactly
   * what fixes it.
   *
   * ## Why this RE-READS the record instead of taking `resume`'s snapshot
   *
   * `resume` reads the order BEFORE attempting the enqueue, and
   * `marketplace.orders.poll` drives `syncOrderFromSource` on its own cadence
   * under no lock shared with this path — so between that read and this write a
   * poll can legitimately provision a destination and set it `synced`. Writing
   * `failed` from the stale snapshot would then drop the synced row and take its
   * `externalOrderId` / `externalOrderNumber` with it, because
   * `OrderRecordRepository.updateSyncStatus` is a DROP-then-append upsert with
   * no `WHERE` on the current status. That is exactly the destructive write
   * #2588 review I-1 refused one path over, and it must not be reintroduced here.
   *
   * **This NARROWS the window to read→write; it does not close it.** Closing it
   * needs a conditional UPDATE that only fires while the row is still the
   * withheld one — a repository-port change. That is disproportionate here: the
   * remaining window is microseconds rather than the whole enqueue round-trip,
   * this whole pass is best-effort by contract, and the surviving race costs a
   * destination order number that the next successful sync rewrites anyway. A
   * later reader should not mistake this for a serialized write.
   *
   * Scoped by {@link isWithheldOnHoldError} rather than by `status === 'pending'`
   * alone, so a destination that is pending for some OTHER reason — a concurrent
   * operator retry that has claimed its slot — is not stolen and mislabelled.
   *
   * Best-effort by construction: a throw here must not turn a modelled `failed`
   * into an unmodelled rejection the controller would have to swallow (interface
   * property 1). The re-read is inside that discipline too — if it fails, nothing
   * is stranded and `resume` still leaves by `{ status: 'failed' }`.
   */
  private async strandWithheldDestinations(internalOrderId: string): Promise<void> {
    let current: OrderRecord | null;
    try {
      current = await this.orderRecordRepository.findById(internalOrderId);
    } catch (readError) {
      this.logger.error(
        `Could not re-read order ${internalOrderId} to strand its withheld destinations after a ` +
          `failed provisioning resume; they stay 'pending' and are NOT retryable from the UI: ${
            readError instanceof Error ? readError.message : String(readError)
          }`,
        readError instanceof Error ? readError.stack : undefined
      );
      return;
    }

    const withheld = (current?.syncStatus ?? []).filter(
      (row) => row.status === 'pending' && isWithheldOnHoldError(row.error)
    );
    // The operator reads this string verbatim in the failure alert, so it names
    // the cause and the next step — and carries none of the provider's message,
    // which may hold credentials (the same rule as the returned failure code).
    const error =
      'The hold was released but the provisioning run could not be re-enqueued. Retry this destination.';

    await Promise.all(
      withheld.map(async (row) => {
        try {
          await this.orderRecordService.updateSyncStatus(
            internalOrderId,
            row.destinationConnectionId,
            {
              destinationConnectionId: row.destinationConnectionId,
              status: 'failed',
              error,
            }
          );
        } catch (writeError) {
          this.logger.error(
            `Could not mark withheld destination ${row.destinationConnectionId} failed after a ` +
              `failed provisioning resume; it stays 'pending' and is NOT retryable from the UI. ` +
              `order=${internalOrderId}: ${
                writeError instanceof Error ? writeError.message : String(writeError)
              }`,
            writeError instanceof Error ? writeError.stack : undefined
          );
        }
      })
    );
  }
}
