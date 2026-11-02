/**
 * Invoicing Marketplace Upload Handler (#3549)
 *
 * Handles `invoicing.marketplaceUpload` - attach an issued invoice's document to
 * the marketplace order it was issued for. Runs after issuance as its own job so
 * nothing here can disturb a committed fiscal document.
 *
 * ## Outcome contract (ADR-007)
 *
 * | Result | Outcome |
 * |---|---|
 * | uploaded, unsupported, no-file, or nothing to do | `ok` - durable on the row (a source that takes no billing document settles `unsupported` before any wait) |
 * | not attachable yet (a document still awaiting the authority's clearance) | **throws** (retryable) - the job polls through the retry ladder without burning an attempt on the row |
 *
 * A document that clears after the ladder runs out leaves this job `dead`. That
 * is expected, not a lost upload: the regulatory-status reconcile sweep enqueues
 * a fresh `invoice-upload:{id}:cleared` job when the record clears, and that job
 * is what sends the document. An operator reading a dead
 * `invoicing.marketplaceUpload` row for a document that later cleared should
 * look for its `:cleared` sibling before retrying by hand.
 * | failed `transient` / `adapter-unresolved` / `order-unmapped` | **throws** (retryable) - a retry can change each |
 * | failed `rejected` | `business_failure` - the marketplace refused the file; retrying cannot change it |
 * | malformed payload | `business_failure` |
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  INVOICE_MARKETPLACE_UPLOAD_SERVICE_TOKEN,
  type IInvoiceMarketplaceUploadService,
} from '@openlinker/core/orders';
import type {
  InvoicingMarketplaceUploadPayloadV1,
  SyncJob,
  SyncJobHandler,
  SyncJobHandlerResult,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class InvoicingMarketplaceUploadHandler implements SyncJobHandler {
  private readonly logger = new Logger(InvoicingMarketplaceUploadHandler.name);

  constructor(
    @Inject(INVOICE_MARKETPLACE_UPLOAD_SERVICE_TOKEN)
    private readonly uploads: IInvoiceMarketplaceUploadService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const invoiceId = (job.payload as Partial<InvoicingMarketplaceUploadPayloadV1> | undefined)
      ?.invoiceId;
    if (typeof invoiceId !== 'string' || invoiceId.length === 0) {
      this.logger.error(`invoicing.marketplaceUpload: invalid payload for job ${job.id}`);
      return { outcome: 'business_failure' };
    }

    const result = await this.uploads.upload(invoiceId);

    switch (result.kind) {
      case 'skipped':
        this.logger.log(
          `invoicing.marketplaceUpload: nothing to do for invoice ${invoiceId} (${result.reason})`
        );
        return { outcome: 'ok' };
      case 'waiting':
        throw this.retryable(job, `document for invoice ${invoiceId} is not attachable yet`);
      case 'settled':
        if (result.status !== 'failed') return { outcome: 'ok' };
        if (result.failureCode === 'rejected') return { outcome: 'business_failure' };
        throw this.retryable(
          job,
          `upload for invoice ${invoiceId} failed (${result.failureCode ?? 'unknown'})`
        );
    }
  }

  private retryable(job: SyncJob, message: string): SyncJobExecutionError {
    return new SyncJobExecutionError(message, job.id, job.jobType, job.connectionId);
  }
}
