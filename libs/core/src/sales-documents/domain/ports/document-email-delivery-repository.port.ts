/**
 * Document Email Delivery Repository Port (#3550)
 *
 * Append-only: a send is recorded once and never edited, so the port has no
 * update. @module libs/core/src/sales-documents/domain/ports
 */
import type { DocumentEmailDelivery } from '../entities/document-email-delivery.entity';
import type {
  DocumentEmailFailureReason,
  DocumentEmailOutcome,
  DocumentEmailSentVia,
} from '../types/document-email.types';
import type { SalesDocumentKind } from '../types/sales-document-kind.types';

export interface RecordDocumentEmailDeliveryInput {
  internalOrderId: string;
  documentKind: SalesDocumentKind;
  documentId: string;
  sentVia: DocumentEmailSentVia | null;
  outcome: DocumentEmailOutcome;
  failureReason: DocumentEmailFailureReason | null;
  recipient: string | null;
  actorUserId: string | null;
}

export interface DocumentEmailDeliveryRepositoryPort {
  record(input: RecordDocumentEmailDeliveryInput): Promise<DocumentEmailDelivery>;
  /** Newest first. */
  listByOrder(internalOrderId: string, limit: number): Promise<DocumentEmailDelivery[]>;
}
