/**
 * Document Email Delivery Domain Entity (#3550)
 *
 * One manual attempt to email a sales document to the buyer: sent, or refused /
 * failed with a closed reason. It exists so the order timeline can show "Invoice
 * emailed to buyer" and "Email to buyer failed" - there was no persisted event
 * to read before. Anemic per ADR-011.
 *
 * `sentVia` is null when the attempt was refused before a sender was chosen.
 * `recipient` is null under `OL_STORE_PII=false`.
 *
 * @module libs/core/src/sales-documents/domain/entities
 */
import type {
  DocumentEmailFailureReason,
  DocumentEmailOutcome,
  DocumentEmailSentVia,
} from '../types/document-email.types';
import type { SalesDocumentKind } from '../types/sales-document-kind.types';

export class DocumentEmailDelivery {
  constructor(
    public readonly id: string,
    public readonly internalOrderId: string,
    public readonly documentKind: SalesDocumentKind,
    public readonly documentId: string,
    public readonly sentVia: DocumentEmailSentVia | null,
    public readonly outcome: DocumentEmailOutcome,
    public readonly failureReason: DocumentEmailFailureReason | null,
    public readonly recipient: string | null,
    public readonly actorUserId: string | null,
    public readonly createdAt: Date
  ) {}
}
