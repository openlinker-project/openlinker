/**
 * Fake KSeF Invoicing Adapter — test double (#1144 / C2 stub)
 *
 * In-memory `InvoicingPort` double consumed only from `*.spec.ts`, so a test can
 * register a KSeF invoicing capability without a real HTTP client or
 * credentials. C2 ships a minimal stub matching the port surface; C9 enriches it
 * with call capture and configurable responses for the core invoicing
 * integration tests. The method signatures here are kept in lockstep with
 * `KsefInvoicingAdapter` / `InvoicingPort` so C9 only adds behaviour, never
 * changes the surface.
 *
 * Kept off the main barrel (exposed via `@openlinker/integrations-ksef/testing`)
 * so test-only logic never enters the runtime bundle.
 *
 * @module libs/integrations/ksef/src/testing
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

export class FakeKsefInvoicingAdapter implements InvoicingPort {
  issueInvoice(_cmd: IssueInvoiceCommand): Promise<InvoiceRecord> {
    return Promise.reject(new Error('FakeKsefInvoicingAdapter.issueInvoice is not implemented (C9)'));
  }

  getInvoice(_query: GetInvoiceQuery): Promise<InvoiceRecord | null> {
    return Promise.resolve(null);
  }

  upsertCustomer(_cmd: UpsertCustomerCommand): Promise<UpsertCustomerResult> {
    return Promise.reject(
      new Error('FakeKsefInvoicingAdapter.upsertCustomer is not implemented (C9)'),
    );
  }

  getSupportedDocumentTypes(): DocumentType[] {
    return [];
  }
}
