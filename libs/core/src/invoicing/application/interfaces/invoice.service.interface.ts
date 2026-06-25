/**
 * Invoice Service Interface
 *
 * Application-service contract for the invoicing bounded context: reads an
 * `InvoiceRecord` by id (backs `GET /invoices/:invoiceId`) and orchestrates
 * issuance — resolving the per-connection `InvoicingPort`, persisting the neutral
 * projection, and snapshotting the issued-document content (§7.3). Country-agnostic
 * (ADR-026): no regime/provider vocabulary crosses this interface.
 *
 * @module libs/core/src/invoicing/application/interfaces
 */
import type { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import type { IssueInvoiceCommand } from '../../domain/types/invoicing.types';

export interface IInvoiceService {
  /** Read a record by its internal id; `null` when unknown. */
  getInvoiceById(invoiceId: string): Promise<InvoiceRecord | null>;

  /**
   * Issue a fiscal document for an order. Resolves the connection's `InvoicingPort`,
   * issues the document, persists the projection, and snapshots the issued-document
   * content (seller resolved by the adapter; lines/VAT computed from the command).
   */
  issueInvoice(cmd: IssueInvoiceCommand): Promise<InvoiceRecord>;
}
