/**
 * Payment Status Refresh Handler (#1354)
 *
 * Thin delegate for jobs of type `invoicing.paymentStatus.refreshByExternalId`.
 * A provider payment webhook (e.g. Infakt `invoice_marked_as_paid`) is enqueued
 * as a by-id refresh; this handler re-reads authoritative provider payment state
 * for the named document via the core `PaymentStatusRefreshService` (which uses
 * the `PaymentStatusReader` sub-capability) and updates OL's projection. The
 * webhook body is never trusted as the source of truth.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  PaymentStatusRefreshByExternalIdPayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import {
  IPaymentStatusRefreshService,
  PAYMENT_STATUS_REFRESH_SERVICE_TOKEN,
} from '@openlinker/core/invoicing';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class PaymentStatusRefreshHandler implements SyncJobHandler {
  private readonly logger = new Logger(PaymentStatusRefreshHandler.name);

  constructor(
    @Inject(PAYMENT_STATUS_REFRESH_SERVICE_TOKEN)
    private readonly refreshService: IPaymentStatusRefreshService,
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing invoicing.paymentStatus.refreshByExternalId job ${job.id} for connection ${job.connectionId}`,
    );

    try {
      const result = await this.refreshService.refreshByExternalId(
        job.connectionId,
        payload.externalInvoiceId,
      );

      this.logger.log(
        `invoicing.paymentStatus.refreshByExternalId completed (connection=${job.connectionId}): ` +
          `outcome=${result.outcome}, paymentStatus=${result.paymentStatus ?? 'n/a'}`,
      );

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Payment status refresh failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private getPayload(job: SyncJob): PaymentStatusRefreshByExternalIdPayloadV1 {
    const payload = job.payload as Partial<PaymentStatusRefreshByExternalIdPayloadV1> | undefined;

    if (
      payload === null ||
      typeof payload !== 'object' ||
      payload.schemaVersion !== 1 ||
      typeof payload.externalInvoiceId !== 'string' ||
      payload.externalInvoiceId.length === 0
    ) {
      throw new SyncJobExecutionError(
        `Invalid invoicing.paymentStatus.refreshByExternalId payload: expected an object with schemaVersion=1 and a non-empty externalInvoiceId`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    return { schemaVersion: 1, externalInvoiceId: payload.externalInvoiceId };
  }
}
