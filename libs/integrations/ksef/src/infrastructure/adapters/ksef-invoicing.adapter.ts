/**
 * KSeF Invoicing Adapter — STUB (#1144 / C2)
 *
 * Per-connection implementation of the neutral `InvoicingPort` (ADR-026) for the
 * KSeF provider. This C2 skeleton declares the full port surface so the plugin's
 * dispatch table type-checks and the manifest can honestly advertise the
 * `Invoicing` capability, but the issuance/clearance mechanics land in C4: every
 * mutating method throws a clearly-labelled not-yet-implemented error, so a
 * caller fails loudly rather than silently no-op'ing a fiscal document.
 *
 * `getSupportedDocumentTypes` returns an empty list in C2 (no document type is
 * issuable yet); C4 fills it with the neutral types the KSeF adapter maps onto
 * the regime. The neutral→KSeF wire mapping (NIP, VAT rates, faktura, KSeF
 * status) is the adapter's exclusive concern (ADR-026) and arrives in C4.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 * @see {@link InvoicingPort}
 */
import type {
  DocumentType,
  GetInvoiceQuery,
  InvoiceRecord,
  InvoicingPort,
  IssueInvoiceCommand,
  UpsertCustomerCommand,
  UpsertCustomerResult,
} from '@openlinker/core/invoicing';
import { KSEF_BRAND } from '../../ksef.constants';
import type { IKsefHttpClient } from '../http/ksef-http-client.interface';

export class KsefInvoicingAdapter implements InvoicingPort {
  constructor(
    private readonly connectionId: string,
    // Accepted (not stored) in the C2 stub so the factory call site is already
    // shaped for C3, where the concrete client is wired in and retained.
    _httpClient: IKsefHttpClient,
  ) {}

  issueInvoice(_cmd: IssueInvoiceCommand): Promise<InvoiceRecord> {
    return Promise.reject(this.notImplemented('issueInvoice'));
  }

  getInvoice(_query: GetInvoiceQuery): Promise<InvoiceRecord | null> {
    return Promise.reject(this.notImplemented('getInvoice'));
  }

  upsertCustomer(_cmd: UpsertCustomerCommand): Promise<UpsertCustomerResult> {
    return Promise.reject(this.notImplemented('upsertCustomer'));
  }

  getSupportedDocumentTypes(): DocumentType[] {
    // No document type is issuable until C4 wires the issuance mechanics.
    return [];
  }

  private notImplemented(method: string): Error {
    return new Error(
      `${KSEF_BRAND} invoicing adapter does not yet implement ${method} (connection ${this.connectionId}); issuance mechanics land in C4.`,
    );
  }
}
