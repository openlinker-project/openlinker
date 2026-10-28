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
 * not ready. The same holds for a source that failed to answer: `none` is only
 * reported when every source that could have produced something actually said
 * no, because a consumer treats `none` as final and a provider outage must not
 * become a permanent "no document".
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
import { UnsupportedRegulatoryDocumentKindError } from '../../domain/exceptions/unsupported-regulatory-document-kind.error';
import type { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import { isTerminalRegulatoryStatus } from '../../domain/types/invoicing.types';
import type {
  InvoiceAttachment,
  InvoiceAttachmentSummary,
} from '../../domain/types/invoice-attachment.types';
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
    let failed = adapter === 'failed';

    if (adapter !== 'failed' && rendersPdf(adapter)) {
      const pdf = await this.readRendered(adapter, record);
      if (pdf === 'waiting') return { state: 'waiting' };
      if (pdf === 'failed') failed = true;
      else if (pdf !== 'absent') return pdf;
    }

    return this.fallBackToLink(record, adapter, failed);
  }

  async describeAttachment(invoiceId: string): Promise<InvoiceAttachmentSummary | null> {
    const record = await this.repo.findById(invoiceId);
    if (record === null) return null;

    const readiness = this.readiness(record);
    if (readiness !== 'ready') return { state: readiness };

    const adapter = await this.resolveAdapter(record);
    // A provider that declares a rendered document can produce it for a cleared
    // record, so the answer is known without downloading it.
    if (adapter !== 'failed' && rendersPdf(adapter)) return { state: 'pdf' };

    return this.fallBackToLink(record, adapter, adapter === 'failed');
  }

  /**
   * Is the document in a state that can have an attachment at all?
   *
   * `waiting` covers both a document still being issued and one the authority has
   * not finished with - the two are the same answer for a caller (try again).
   * Readiness is the terminal regulatory set, so a status the regime has not
   * settled (`submitted`, `pending-submission`, and `cleared`, which no adapter
   * writes today and which is not terminal in that set) waits rather than being
   * guessed final. A terminal failure or a rejected clearance never produces one.
   */
  private readiness(record: InvoiceRecord): 'ready' | 'waiting' | 'none' {
    if (record.status === 'failed') return 'none';
    if (record.status !== 'issued') return 'waiting';
    if (record.regulatoryStatus === 'rejected') return 'none';
    return isTerminalRegulatoryStatus(record.regulatoryStatus) ? 'ready' : 'waiting';
  }

  /** The stored url, then the verification link, then the final answer. */
  private async fallBackToLink(
    record: InvoiceRecord,
    adapter: InvoicingPort | 'failed',
    failedSoFar: boolean
  ): Promise<InvoiceAttachment & InvoiceAttachmentSummary> {
    // A stored url is the provider's own statement of where the document lives.
    if (record.pdfUrl !== null && record.pdfUrl.length > 0) {
      return { state: 'link', url: record.pdfUrl };
    }

    let failed = failedSoFar;
    if (adapter !== 'failed' && isRegulatoryVerificationLinkReader(adapter)) {
      const link = await this.readVerificationLink(adapter, record);
      if (link === 'failed') failed = true;
      else if (link !== 'absent') return { state: 'link', url: link.url };
    }

    return failed ? { state: 'waiting' } : { state: 'none' };
  }

  /**
   * A provider that cannot be resolved has nothing to read; the stored url may
   * still serve. An unresolvable connection (disabled, mid re-auth) is transient,
   * so it counts as a failed source rather than as "no document".
   */
  private async resolveAdapter(record: InvoiceRecord): Promise<InvoicingPort | 'failed'> {
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
      return 'failed';
    }
  }

  /**
   * `absent` - the provider said it has nothing of this kind; `failed` - it did
   * not answer. Only `absent` lets the read conclude `none`.
   */
  private async readRendered(
    adapter: InvoicingPort & RegulatoryDocumentReader,
    record: InvoiceRecord
  ): Promise<InvoiceAttachment | 'waiting' | 'absent' | 'failed'> {
    try {
      const document = await adapter.getRegulatoryDocument(record, 'rendered');
      return { state: 'pdf', content: document.content, contentType: document.contentType };
    } catch (error) {
      if (error instanceof RegulatoryDocumentNotReadyError) return 'waiting';
      // The provider said it cannot produce this kind: a real "nothing here".
      if (error instanceof UnsupportedRegulatoryDocumentKindError) return 'absent';
      // Anything else (transport, 5xx) says nothing about whether the document
      // exists, so it must not let the read conclude `none`.
      this.logger.warn(
        `Rendered document unavailable for invoice ${record.id}, trying a link: ${describe(error)}`
      );
      return 'failed';
    }
  }

  private async readVerificationLink(
    adapter: InvoicingPort & RegulatoryVerificationLinkReader,
    record: InvoiceRecord
  ): Promise<{ url: string } | 'absent' | 'failed'> {
    try {
      const link = await adapter.getVerificationLink(record);
      return link?.url ? { url: link.url } : 'absent';
    } catch (error) {
      this.logger.warn(`No verification link for invoice ${record.id}: ${describe(error)}`);
      return 'failed';
    }
  }
}

function rendersPdf(adapter: InvoicingPort): adapter is InvoicingPort & RegulatoryDocumentReader {
  return isRegulatoryDocumentReader(adapter) && supportsRegulatoryDocumentKind(adapter, 'rendered');
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
