/**
 * Invoice Attachment Service (#3548)
 *
 * The one read that answers "what can I attach for this issued document?" for
 * every provider, so a parcel, an email and a marketplace upload do not each
 * have to know that inFakt hands over PDF bytes, Subiekt and eparagony a stored
 * url, and KSeF the authority's verification link.
 *
 * Preference order, most useful first, each step falling through on absence or
 * failure rather than throwing:
 *   1. real bytes - the provider's `rendered` document (inFakt's PDF, KSeF's own
 *      PDF of the FA(3) it submitted, #3620);
 *   2. the stored `pdfUrl` the provider returned at issue (Subiekt, eparagony);
 *   3. the authority's public verification link (KSeF's KOD I url).
 *
 * A document that is not cleared reports `waiting` rather than `none`: the
 * difference is "try again later" versus "there will not be one", and a surface
 * that conflates them tells an operator a document is missing when it is merely
 * not ready. A rejected or failed document will never have one, so it is `none`.
 *
 * @module libs/core/src/invoicing/application/services
 * @implements {IInvoiceAttachmentService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { INVOICE_RECORD_REPOSITORY_TOKEN } from '../../invoicing.tokens';
import { InvoiceRecordRepositoryPort } from '../../domain/ports/invoice-record-repository.port';
import type { InvoicingPort } from '../../domain/ports/invoicing.port';
import {
  isRegulatoryDocumentReader,
  supportsRegulatoryDocumentKind,
  type RegulatoryDocumentReader,
} from '../../domain/ports/capabilities/regulatory-document-reader.capability';
import {
  isRegulatoryVerificationLinkReader,
  type RegulatoryVerificationLinkReader,
} from '../../domain/ports/capabilities/regulatory-verification-link-reader.capability';
import { RegulatoryDocumentNotReadyError } from '../../domain/exceptions/regulatory-document-not-ready.error';
import type { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import type { InvoiceAttachment } from '../../domain/types/invoice-attachment.types';
import type { IInvoiceAttachmentService } from './invoice-attachment.service.interface';

@Injectable()
export class InvoiceAttachmentService implements IInvoiceAttachmentService {
  private readonly logger = new Logger(InvoiceAttachmentService.name);

  constructor(
    @Inject(INVOICE_RECORD_REPOSITORY_TOKEN)
    private readonly repo: InvoiceRecordRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService
  ) {}

  async resolveAttachment(invoiceId: string): Promise<InvoiceAttachment | null> {
    const record = await this.repo.findById(invoiceId);
    if (record === null) return null;

    const readiness = this.readiness(record);
    if (readiness !== 'ready') return { state: readiness };

    const adapter = await this.resolveAdapter(record);

    if (adapter !== null && isRegulatoryDocumentReader(adapter)) {
      if (supportsRegulatoryDocumentKind(adapter, 'rendered')) {
        const pdf = await this.readRendered(adapter, record);
        if (pdf === 'waiting') return { state: 'waiting' };
        if (pdf !== null) return pdf;
      }
    }

    // A stored url is the provider's own statement of where the document lives.
    if (record.pdfUrl !== null && record.pdfUrl.length > 0) {
      return { state: 'link', url: record.pdfUrl };
    }

    if (adapter !== null && isRegulatoryVerificationLinkReader(adapter)) {
      const link = await this.readVerificationLink(adapter, record);
      if (link !== null) return { state: 'link', url: link };
    }

    return { state: 'none' };
  }

  /**
   * Is the document in a state that can have an attachment at all?
   *
   * `waiting` covers both a document still being issued and one the authority has
   * not cleared yet - the two are the same answer for a caller (try again). A
   * terminal failure or a rejected clearance will never produce one.
   */
  private readiness(record: InvoiceRecord): 'ready' | 'waiting' | 'none' {
    if (record.status === 'failed') return 'none';
    if (record.status !== 'issued') return 'waiting';
    if (record.regulatoryStatus === 'rejected') return 'none';
    if (record.regulatoryStatus === 'accepted' || record.regulatoryStatus === 'not-applicable') {
      return 'ready';
    }
    return 'waiting';
  }

  /** A provider that cannot be resolved has nothing to read; the stored url may still serve. */
  private async resolveAdapter(record: InvoiceRecord): Promise<InvoicingPort | null> {
    try {
      return await this.integrations.getCapabilityAdapter<InvoicingPort>(
        record.connectionId,
        'Invoicing'
      );
    } catch (error) {
      this.logger.warn(
        `Could not resolve the invoicing adapter for connection ${record.connectionId} while ` +
          `looking for an attachment of invoice ${record.id}: ${describe(error)}`
      );
      return null;
    }
  }

  private async readRendered(
    adapter: InvoicingPort & RegulatoryDocumentReader,
    record: InvoiceRecord
  ): Promise<InvoiceAttachment | 'waiting' | null> {
    try {
      const document = await adapter.getRegulatoryDocument(record, 'rendered');
      return { state: 'pdf', content: document.content, contentType: document.contentType };
    } catch (error) {
      if (error instanceof RegulatoryDocumentNotReadyError) return 'waiting';
      // Any other failure (unsupported kind, transport) falls through to a link:
      // an attachment is a convenience that must never turn into an error.
      this.logger.warn(
        `Rendered document unavailable for invoice ${record.id}, trying a link: ${describe(error)}`
      );
      return null;
    }
  }

  private async readVerificationLink(
    adapter: InvoicingPort & RegulatoryVerificationLinkReader,
    record: InvoiceRecord
  ): Promise<string | null> {
    try {
      const link = await adapter.getVerificationLink(record);
      return link?.url ?? null;
    } catch (error) {
      this.logger.warn(`No verification link for invoice ${record.id}: ${describe(error)}`);
      return null;
    }
  }
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
