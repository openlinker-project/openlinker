/**
 * Invoicing Port
 *
 * Capability contract for issuing fiscal documents through a provider, resolved
 * per-connection via the integrations registry (capability `'Invoicing'`), the
 * same way `OfferManagerPort`/`ShopProductManagerPort` are. A pure mechanism:
 * it issues what the command describes and does not decide whether/when/which
 * document to issue — that policy lives above it in a future rules layer
 * (ADR-026). Regulatory transmission/clearance (KSeF/SDI/…) is a separate
 * ADR-002 sub-capability (`RegulatoryTransmitter`), added when the first such
 * provider lands — not part of this base contract.
 *
 * @module libs/core/src/invoicing/domain/ports
 */
import type { InvoiceRecord } from '../entities/invoice-record.entity';
import type {
  DocumentType,
  GetInvoiceQuery,
  IssueInvoiceCommand,
  UpsertCustomerCommand,
  UpsertCustomerResult,
} from '../types/invoicing.types';

export interface InvoicingPort {
  /** Issue a fiscal document for an order; returns the persisted projection. */
  issueInvoice(cmd: IssueInvoiceCommand): Promise<InvoiceRecord>;

  /** Fetch an issued document by order id or provider id; `null` when absent. */
  getInvoice(query: GetInvoiceQuery): Promise<InvoiceRecord | null>;

  /** Create-or-update the buyer as a customer in the provider. */
  upsertCustomer(cmd: UpsertCustomerCommand): Promise<UpsertCustomerResult>;

  /**
   * Discovery: which neutral document types this provider can issue. Lets the
   * caller adapt without country/provider string-matching (Avalara GetMandates
   * precedent). Value-level variance — distinct from the method-bearing
   * `RegulatoryTransmitter` sub-capability.
   */
  getSupportedDocumentTypes(): DocumentType[];
}
