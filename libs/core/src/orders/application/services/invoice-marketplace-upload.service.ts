/**
 * Invoice Marketplace Upload Service (#3549)
 *
 * Attaches an issued sales document to the marketplace order it was issued for,
 * so the buyer sees it there. Best-effort by construction: it runs as its own
 * job after issuance, never inside it, so nothing here can disturb a committed
 * fiscal document.
 *
 * Lives in `orders`, not `invoicing`, for the same reason the auto-issue
 * trigger REPORTS its outcome instead of persisting it: this needs the order
 * record and the marketplace adapter, and `InvoicingModule` must never import an
 * orders token (the one-way edge `invoicing-auto-issue-boot.int-spec.ts`
 * guards). `OrdersModule` already imports `InvoicingModule`, so the dependency
 * runs the permitted way, through `IInvoiceService` and `IInvoiceAttachmentService`.
 *
 * Order of work is deliberate. The attachment is resolved BEFORE the attempt is
 * claimed, so a document that is merely not ready yet answers `waiting` without
 * touching the row - polling for a KSeF number must not burn attempts or read as
 * a failure. Only then is the attempt claimed, which is the at-most-once point.
 *
 * Real bytes go through the uploader. A document the provider only offers as a
 * link goes through the linker instead, when the marketplace has one and the
 * url is one a buyer can open ({@link isShareableBillingDocumentUrl}); the url
 * is handed over as it is and never fetched. A file still wins over a link.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IInvoiceMarketplaceUploadService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  CORE_ENTITY_TYPE,
} from '@openlinker/core/identifier-mapping';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { JobEnqueuePort, JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import {
  IInvoiceService,
  INVOICE_SERVICE_TOKEN,
  INVOICE_ATTACHMENT_SERVICE_TOKEN,
  type IInvoiceAttachmentService,
} from '@openlinker/core/invoicing';
import type {
  IInvoiceMarketplaceUploadService,
  InvoiceMarketplaceUploadResult,
} from '../interfaces/invoice-marketplace-upload.service.interface';
import { IOrderRecordService } from '../interfaces/order-record.service.interface';
import type { OrderSourcePort } from '../../domain/ports/order-source.port';
import { isOrderBillingDocumentUploader } from '../../domain/ports/capabilities/order-billing-document-uploader.capability';
import { isOrderBillingDocumentLinker } from '../../domain/ports/capabilities/order-billing-document-linker.capability';
import { InvoiceMarketplaceUploadRepositoryPort } from '../../domain/ports/invoice-marketplace-upload-repository.port';
import type {
  InvoiceMarketplaceUpload,
  InvoiceMarketplaceUploadFailureCode,
  RecordInvoiceMarketplaceUploadOutcome,
} from '../../domain/types/invoice-marketplace-upload.types';
import {
  isShareableBillingDocumentUrl,
  type UploadBillingDocumentResult,
} from '../../domain/types/order-billing-document.types';
import {
  INVOICE_MARKETPLACE_UPLOAD_REPOSITORY_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
} from '../../orders.tokens';

/** Characters a marketplace file name should not carry; the number may hold `/`. */
const UNSAFE_FILE_NAME_CHARS = /[^A-Za-z0-9._-]+/g;

@Injectable()
export class InvoiceMarketplaceUploadService implements IInvoiceMarketplaceUploadService {
  private readonly logger = new Logger(InvoiceMarketplaceUploadService.name);

  constructor(
    @Inject(INVOICE_MARKETPLACE_UPLOAD_REPOSITORY_TOKEN)
    private readonly uploads: InvoiceMarketplaceUploadRepositoryPort,
    @Inject(INVOICE_SERVICE_TOKEN)
    private readonly invoices: IInvoiceService,
    @Inject(INVOICE_ATTACHMENT_SERVICE_TOKEN)
    private readonly attachments: IInvoiceAttachmentService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orders: IOrderRecordService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort
  ) {}

  async enqueueUpload(
    invoiceId: string,
    options: { retry?: boolean; cleared?: boolean } = {}
  ): Promise<'enqueued' | 'skipped' | 'failed'> {
    try {
      const invoice = await this.invoices.getInvoiceById(invoiceId);
      if (invoice === null) return 'skipped';
      const order = await this.orders.getOrderRecord(invoice.orderId);
      if (order === null) return 'skipped';
      const idempotencyKey = options.retry
        ? `invoice-upload:${invoiceId}:retry:${Date.now()}`
        : options.cleared
          ? `invoice-upload:${invoiceId}:cleared`
          : `invoice-upload:${invoiceId}`;
      await this.jobEnqueue.enqueueJob({
        jobType: 'invoicing.marketplaceUpload',
        connectionId: order.sourceConnectionId,
        payload: { schemaVersion: 1, invoiceId },
        idempotencyKey,
      });
      return 'enqueued';
    } catch (error) {
      this.logger.error(
        `Could not enqueue the marketplace upload for invoice ${invoiceId}: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
      return 'failed';
    }
  }

  async upload(invoiceId: string): Promise<InvoiceMarketplaceUploadResult> {
    const invoice = await this.invoices.getInvoiceById(invoiceId);
    if (invoice === null) return { kind: 'skipped', reason: 'invoice-not-found' };

    const order = await this.orders.getOrderRecord(invoice.orderId);
    if (order === null) return { kind: 'skipped', reason: 'order-not-found' };

    // A row that is already terminal needs nothing, and resolving the
    // attachment downloads the document from the provider - two triggers (the
    // first job and the clearance) must not cost two downloads for one upload.
    // The claim below still decides; this only avoids wasted work.
    const existing = await this.uploads.findByInvoiceId(invoiceId);
    if (
      existing.some(
        (row) =>
          row.targetConnectionId === order.sourceConnectionId &&
          (row.status === 'uploaded' || row.status === 'unsupported')
      )
    ) {
      return { kind: 'skipped', reason: 'already-settled' };
    }

    const attachment = await this.attachments.resolveAttachment(invoiceId);
    if (attachment !== null && attachment.state === 'waiting') return { kind: 'waiting' };

    // `null` = terminal, or another attempt holds the row right now; either way
    // there is nothing for this run to send.
    const claimed = await this.uploads.claimAttempt(invoiceId, order.sourceConnectionId);
    if (claimed === null) return { kind: 'skipped', reason: 'already-settled' };

    // Nothing to send: no file, and no link a buyer could open. Recorded as
    // having no file, which stays claimable - the provider may produce one
    // later. A link is never fetched to turn it into a file: that would open an
    // outbound-fetch surface on a provider-controlled url.
    if (
      attachment === null ||
      (attachment.state !== 'pdf' &&
        !(attachment.state === 'link' && isShareableBillingDocumentUrl(attachment.url)))
    ) {
      return this.settle(claimed, { status: 'no-file' });
    }

    const externalOrderId = await this.resolveExternalOrderId(
      invoice.orderId,
      order.sourceConnectionId
    );
    if (externalOrderId === null) {
      return this.settle(claimed, { status: 'failed', lastFailureCode: 'order-unmapped' });
    }

    const adapter = await this.resolveAdapter(order.sourceConnectionId);
    if (adapter === 'unresolved') {
      return this.settle(claimed, { status: 'failed', lastFailureCode: 'adapter-unresolved' });
    }

    const documentNumber = invoice.documentNumber ?? invoice.providerInvoiceNumber ?? invoice.id;
    let result: UploadBillingDocumentResult;
    try {
      if (attachment.state === 'pdf') {
        if (!isOrderBillingDocumentUploader(adapter)) {
          return this.settle(claimed, { status: 'unsupported' });
        }
        result = await adapter.uploadBillingDocument({
          externalOrderId,
          documentNumber,
          fileName: toFileName(documentNumber),
          contentType: attachment.contentType,
          content: attachment.content,
        });
      } else {
        // A marketplace that takes files but no links has not refused the
        // document: a file may still appear for it, so it stays claimable.
        if (!isOrderBillingDocumentLinker(adapter)) {
          return this.settle(
            claimed,
            isOrderBillingDocumentUploader(adapter)
              ? { status: 'no-file' }
              : { status: 'unsupported' }
          );
        }
        result = await adapter.attachBillingDocumentLink({
          externalOrderId,
          documentNumber,
          url: attachment.url,
        });
      }
    } catch (error) {
      // An adapter is meant to answer through the result; a throw is an
      // unmodelled condition, which a retry can still change. The message is
      // logged and never persisted (it can carry order data).
      this.logger.warn(
        `Billing document upload threw for invoice ${invoiceId} on connection ` +
          `${order.sourceConnectionId}: ${error instanceof Error ? error.message : String(error)}`
      );
      return this.settle(claimed, { status: 'failed', lastFailureCode: 'transient' });
    }
    return this.settle(claimed, toOutcome(result));
  }

  getStatus(invoiceId: string): Promise<InvoiceMarketplaceUpload[]> {
    return this.uploads.findByInvoiceId(invoiceId);
  }

  private async settle(
    claimed: InvoiceMarketplaceUpload,
    outcome: RecordInvoiceMarketplaceUploadOutcome
  ): Promise<InvoiceMarketplaceUploadResult> {
    const applied = await this.uploads.recordOutcome(claimed.id, claimed.attempts, outcome);
    if (!applied) {
      // Another attempt settled the row, or took it over after our lease ran
      // out; its answer stands and ours must not overwrite it.
      return { kind: 'skipped', reason: 'already-settled' };
    }
    return {
      kind: 'settled',
      status: outcome.status,
      failureCode: outcome.lastFailureCode ?? null,
    };
  }

  private async resolveExternalOrderId(
    internalOrderId: string,
    sourceConnectionId: string
  ): Promise<string | null> {
    const mappings = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Order,
      internalOrderId
    );
    return (
      mappings.find((mapping) => mapping.connectionId === sourceConnectionId)?.externalId ?? null
    );
  }

  /**
   * `'unresolved'` = the adapter could not be built, which is a transient
   * condition (a disabled connection, a credential refresh). Which document
   * capabilities it has is the caller's question.
   */
  private async resolveAdapter(connectionId: string): Promise<OrderSourcePort | 'unresolved'> {
    let adapter: OrderSourcePort;
    try {
      adapter = await this.integrations.getCapabilityAdapter<OrderSourcePort>(
        connectionId,
        'OrderSource'
      );
    } catch (error) {
      this.logger.warn(
        `Could not resolve the order source for connection ${connectionId}: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
      return 'unresolved';
    }
    return adapter;
  }
}

const toFileName = (documentNumber: string): string => {
  const base = documentNumber.replace(UNSAFE_FILE_NAME_CHARS, '-').replace(/^-+|-+$/g, '');
  return `${base.length > 0 ? base : 'document'}.pdf`;
};

const toOutcome = (result: UploadBillingDocumentResult): RecordInvoiceMarketplaceUploadOutcome => {
  switch (result.outcome) {
    case 'uploaded':
    case 'already-present':
      return { status: 'uploaded' };
    case 'unsupported':
      return { status: 'unsupported' };
    case 'rejected':
      return {
        status: 'failed',
        lastFailureCode: 'rejected' satisfies InvoiceMarketplaceUploadFailureCode,
      };
    case 'transient-failure':
      return {
        status: 'failed',
        lastFailureCode: 'transient' satisfies InvoiceMarketplaceUploadFailureCode,
      };
  }
};
