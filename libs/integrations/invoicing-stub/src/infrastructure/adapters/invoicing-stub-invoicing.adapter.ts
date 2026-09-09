/**
 * Invoicing-stub Invoicing Adapter
 *
 * Implements `InvoicingPort` against the standalone perf-lab HTTP stub
 * (`perf/openlinker-throughput/stubs/invoicing/server.mjs`, #3006). This is a
 * REAL adapter — it makes a REAL outbound HTTP call — so `issueInvoice` runs
 * through the exact same core `InvoiceService.issueInvoice()` code path (the
 * per-order lock, the `pending` row, the exactly-once idempotency gate, the
 * `updateOutcome` write) that a production adapter (KSeF/inFakt/Subiekt) does.
 * The ONLY thing this adapter's destination fakes is the provider's own
 * decision latency: the stub sleeps a fixed, operator-chosen number of
 * milliseconds before answering, instead of a real authority's variance.
 *
 * NEVER register this plugin unconditionally — see the package README and
 * `apps/{api,worker}/src/plugins.ts` for the `OL_INVOICING_STUB_ENABLED` gate.
 * No document this adapter "issues" is a real fiscal document; nothing here
 * transmits to a tax authority.
 *
 * @module libs/integrations/invoicing-stub/src/infrastructure/adapters
 */
import type { LoggerPort } from '@openlinker/shared/logging';
import type { FetchLike } from '@openlinker/shared/http';
import { InvoiceRecord } from '@openlinker/core/invoicing';
import type {
  DocumentType,
  GetInvoiceQuery,
  IssueInvoiceCommand,
  IssueInvoiceResult,
  InvoicingPort,
  UpsertCustomerCommand,
  UpsertCustomerResult,
} from '@openlinker/core/invoicing';

import { INVOICING_STUB_PLATFORM_TYPE } from '../../invoicing-stub.constants';

interface StubIssueResponse {
  id: string;
  number: string;
  status: 'issued';
  issuedAt: string;
}

export class InvoicingStubConfigException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoicingStubConfigException';
  }
}

export class InvoicingStubInvoicingAdapter implements InvoicingPort {
  constructor(
    private readonly connectionId: string,
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike,
    private readonly logger: LoggerPort,
  ) {}

  async issueInvoice(cmd: IssueInvoiceCommand): Promise<IssueInvoiceResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The stub reads the body only to hold a real HTTP round-trip open; no
      // buyer PII is sent — this is a lab-only fake destination and the fields
      // below are the minimum needed to correlate a stub response with the
      // command that produced it in a driver-side log, never persisted PII.
      body: JSON.stringify({ orderId: cmd.orderId, connectionId: cmd.connectionId }),
    });

    if (!response.ok) {
      throw new Error(
        `invoicing-stub answered HTTP ${String(response.status)} for orderId=${cmd.orderId}`,
      );
    }

    const body = (await response.json()) as StubIssueResponse;
    this.logger.log(
      `invoicing-stub issued ${body.id} for orderId=${cmd.orderId} connectionId=${this.connectionId}`,
    );

    const now = new Date();
    const record = new InvoiceRecord(
      cmd.orderId, // id — never persisted under this value; core reads only the fields below
      cmd.connectionId,
      cmd.orderId,
      INVOICING_STUB_PLATFORM_TYPE,
      cmd.documentType ?? 'invoice',
      'issued',
      body.id,
      body.number,
      'not-applicable',
      null,
      cmd.idempotencyKey ?? null,
      null,
      cmd.issuedAt ?? new Date(body.issuedAt || now.toISOString()),
      null,
      now,
      now,
    );

    return { record };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface requires Promise; no network call needed for this stub
  async getInvoice(_query: GetInvoiceQuery): Promise<InvoiceRecord | null> {
    // Not needed for the measurement this adapter exists to drive — the stub
    // holds no per-order state to look up. `InvoiceService` never calls this
    // from the `issueInvoice` path.
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface requires Promise; no network call needed for this stub
  async upsertCustomer(_cmd: UpsertCustomerCommand): Promise<UpsertCustomerResult> {
    // Never called by `issueInvoice`; returned for interface completeness only.
    return { providerCustomerId: 'invoicing-stub-customer' };
  }

  getSupportedDocumentTypes(): DocumentType[] {
    return ['invoice'];
  }
}
