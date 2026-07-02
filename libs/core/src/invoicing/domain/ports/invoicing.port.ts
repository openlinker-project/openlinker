/**
 * Invoicing Port
 *
 * Capability contract for issuing fiscal documents through a provider, resolved
 * per-connection via the integrations registry (capability `'Invoicing'`), the
 * same way `OfferManagerPort`/`ShopProductManagerPort` are. A pure mechanism:
 * it issues what the command describes and does not decide whether/when/which
 * document to issue — that policy lives above it in a future rules layer
 * (ADR-026). Regulatory transmission/clearance (KSeF/SDI/…) is a separate
 * ADR-002 sub-capability. The READ side is `RegulatoryStatusReader` (#1121),
 * read-only reconciliation that populates the neutral regulatory fields by
 * reading authoritative provider/CTC status; the still-future SUBMIT side is
 * `RegulatoryTransmitter`, added when the first transmitting
 * provider lands — not part of this base contract.
 *
 * @module libs/core/src/invoicing/domain/ports
 */
import type { InvoiceRecord } from '../entities/invoice-record.entity';
import type {
  DocumentType,
  GetInvoiceQuery,
  IssueInvoiceCommand,
  IssueInvoiceResult,
  UpsertCustomerCommand,
  UpsertCustomerResult,
} from '../types/invoicing.types';

export interface InvoicingPort {
  /**
   * Issue a fiscal document for an order; returns the neutral projection plus an
   * optional adapter-resolved `seller` block (see {@link IssueInvoiceResult}). The
   * adapter is a pure mechanism — persistence + the exactly-once dedup gate are
   * owned by the core `InvoiceService`, which snapshots the issued-document content.
   */
  issueInvoice(cmd: IssueInvoiceCommand): Promise<IssueInvoiceResult>;

  /** Fetch an issued document by order id or provider id; `null` when absent. */
  getInvoice(query: GetInvoiceQuery): Promise<InvoiceRecord | null>;

  /** Create-or-update the buyer as a customer in the provider. */
  upsertCustomer(cmd: UpsertCustomerCommand): Promise<UpsertCustomerResult>;

  /**
   * Discovery: which neutral document types this provider can issue. Lets the
   * caller adapt without country/provider string-matching (Avalara GetMandates
   * precedent). Value-level variance, distinct from the method-bearing
   * regulatory sub-capabilities (`RegulatoryStatusReader` / future
   * `RegulatoryTransmitter`).
   */
  getSupportedDocumentTypes(): DocumentType[];
}
