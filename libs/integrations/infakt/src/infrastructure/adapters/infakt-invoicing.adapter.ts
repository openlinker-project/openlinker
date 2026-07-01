/**
 * Infakt Invoicing Adapter
 *
 * Implements `InvoicingPort`, `RegulatoryStatusReader`, and `CorrectionIssuer`
 * over the Infakt REST API v3. PL-specific logic (NIP mapping, ksef_data polling,
 * paragon vs faktura) stays here — never bleeds into libs/core.
 *
 * KSeF model: OL calls `issueInvoice` (creates a draft in Infakt) then
 * `getClearanceStatus` reads `ksef_data.status` off the stored invoice UUID.
 * Infakt submits to KSeF natively; OL does not build FA(3) XML. This is why the
 * adapter implements `RegulatoryStatusReader` (read-only clearance poll), NOT
 * `RegulatoryTransmitter` (active KSeF session + submit).
 *
 * @module libs/integrations/infakt/src/infrastructure/adapters
 */
import { randomUUID } from 'crypto';
import type { LoggerPort } from '@openlinker/shared/logging';
import type {
  CorrectionIssuer,
  DocumentType,
  GetInvoiceQuery,
  IssueCorrectionCommand,
  IssueInvoiceCommand,
  InvoicingPort,
  RegulatoryClearanceResult,
  RegulatoryStatus,
  RegulatoryStatusReader,
  UpsertCustomerCommand,
  UpsertCustomerResult,
} from '@openlinker/core/invoicing';
import { InvoiceRecord } from '@openlinker/core/invoicing';
import type { IInfaktHttpClient } from '../http/infakt-http-client.interface';
import { InfaktApiError } from '../../domain/exceptions/infakt-api.error';
import type {
  InfaktClient,
  InfaktInvoice,
  InfaktKsefStatus,
  InfaktListResponse,
  InfaktSendToKsefResponse,
} from '../../domain/types/infakt.types';

export const INFAKT_PROVIDER_TYPE = 'infakt';

const SUPPORTED_DOCUMENT_TYPES: readonly DocumentType[] = [
  'invoice',
  'corrected',
  'proforma',
  'prepayment',
];

/** Maps Infakt ksef_data.status → neutral RegulatoryStatus. */
function toRegulatoryStatus(ksefStatus: InfaktKsefStatus | null | undefined): RegulatoryStatus {
  if (!ksefStatus) return 'not-applicable';
  switch (ksefStatus) {
    case 'pending':
    case 'sent':
      return 'submitted';
    case 'success':
      return 'cleared';
    case 'error':
      return 'rejected';
  }
}

/** Maps neutral taxRate string to Infakt tax_symbol. */
function toInfaktTaxSymbol(taxRate: string): string {
  // Common neutral→Infakt mapping; adapter owns this PL logic
  switch (taxRate) {
    case '23':
    case '0.23':
      return '23';
    case '8':
    case '0.08':
      return '8';
    case '5':
    case '0.05':
      return '5';
    case '0':
    case '0.00':
    case 'zw':
    case 'exempt':
      return 'zw';
    case 'np':
    case 'oo':
      return 'np';
    default:
      return taxRate;
  }
}

export class InfaktInvoicingAdapter
  implements InvoicingPort, RegulatoryStatusReader, CorrectionIssuer
{
  constructor(
    private readonly connectionId: string,
    private readonly http: IInfaktHttpClient,
    private readonly logger: LoggerPort,
  ) {}

  getSupportedDocumentTypes(): DocumentType[] {
    return [...SUPPORTED_DOCUMENT_TYPES];
  }

  async upsertCustomer(cmd: UpsertCustomerCommand): Promise<UpsertCustomerResult> {
    const { buyer } = cmd;
    // Infakt uses NIP (pl-nip scheme) for B2B client dedup
    const nip = buyer.taxId?.scheme === 'pl-nip' ? buyer.taxId.value : null;

    // Search for existing client by NIP first
    if (nip) {
      const existing = await this.findClientByNip(nip);
      if (existing) {
        this.logger.log(`Infakt client found by NIP ${nip}: ${existing.uuid}`);
        return { providerCustomerId: existing.uuid };
      }
    }

    // Create new client
    const payload = {
      client: {
        name: buyer.name,
        nip: nip ?? undefined,
        city: buyer.address.city,
        street: buyer.address.line1,
        post_code: buyer.address.postalCode,
        country: buyer.address.countryIso2,
      },
    };

    // InfaktApiError carries `failureMode`; propagate as-is (see issueInvoice).
    const created = await this.http.post<InfaktClient>('clients.json', payload);
    this.logger.log(`Infakt client created: ${created.uuid}`);
    return { providerCustomerId: created.uuid };
  }

  async issueInvoice(cmd: IssueInvoiceCommand): Promise<InvoiceRecord> {
    const { lines, currency, documentType, idempotencyKey, orderId } = cmd;
    const clientUuid = await this.resolveClientUuid(cmd);

    const kind = documentType === 'proforma' ? 'proforma' : 'vat';
    const services = lines.map((l) => ({
      name: l.name,
      tax_symbol: toInfaktTaxSymbol(l.taxRate),
      quantity: l.quantity,
      unit: 'szt.',
      unit_net_price: `${l.unitPriceGross / (1 + this.taxRateNumeric(l.taxRate))} ${currency ?? 'PLN'}`,
    }));

    const payload = {
      invoice: {
        kind,
        payment_method: 'transfer',
        client_uuid: clientUuid,
        services,
        ...(idempotencyKey ? { external_id: idempotencyKey } : {}),
      },
    };

    // InfaktApiError carries the neutral `failureMode` discriminator core's
    // InvoiceService reads structurally (#1200) — propagate as-is rather
    // than wrapping into a plain Error, which would erase that signal.
    const invoice = await this.http.post<InfaktInvoice>('invoices.json', payload);

    this.logger.log(`Infakt invoice created: ${invoice.uuid} (${invoice.number ?? 'draft'})`);

    const ksefStatus = invoice.ksef_data?.status ?? null;
    const now = new Date();
    return new InvoiceRecord(
      randomUUID(),
      this.connectionId,
      orderId,
      INFAKT_PROVIDER_TYPE,
      documentType ?? 'invoice',
      'issued',
      invoice.uuid,
      invoice.number ?? null,
      toRegulatoryStatus(ksefStatus),
      invoice.ksef_data?.ksef_number ?? null,
      idempotencyKey ?? null,
      invoice.pdf_url ?? null,
      now,
      null,
      now,
      now,
    );
  }

  async getInvoice(query: GetInvoiceQuery): Promise<InvoiceRecord | null> {
    const providerInvoiceId =
      'providerInvoiceId' in query ? query.providerInvoiceId : null;
    if (!providerInvoiceId) {
      // orderId-based lookup not supported by Infakt; must go via OL's own store
      return null;
    }

    try {
      const invoice = await this.http.get<InfaktInvoice>(
        `invoices/${providerInvoiceId}.json`,
        { invoice_type: invoice_kind_to_type(invoice_uuid_kind(providerInvoiceId)) },
      );
      const now = new Date();
      return new InvoiceRecord(
        randomUUID(),
        this.connectionId,
        '',
        INFAKT_PROVIDER_TYPE,
        invoice.kind === 'corrective' ? 'corrected' : 'invoice',
        'issued',
        invoice.uuid,
        invoice.number ?? null,
        toRegulatoryStatus(invoice.ksef_data?.status ?? null),
        invoice.ksef_data?.ksef_number ?? null,
        null,
        invoice.pdf_url ?? null,
        invoice.invoice_date ? new Date(invoice.invoice_date) : now,
        null,
        now,
        now,
      );
    } catch (err) {
      if (err instanceof InfaktApiError && err.statusCode === 404) return null;
      throw err;
    }
  }

  async getClearanceStatus(record: InvoiceRecord): Promise<RegulatoryClearanceResult> {
    if (!record.providerInvoiceId) {
      return { regulatoryStatus: 'not-applicable' };
    }

    const invoice = await this.http.get<InfaktInvoice>(
      `invoices/${record.providerInvoiceId}.json`,
      { invoice_type: 'vat' },
    );

    const ksefData = invoice.ksef_data;
    return {
      regulatoryStatus: toRegulatoryStatus(ksefData?.status ?? null),
      clearanceReference: ksefData?.ksef_number ?? null,
    };
  }

  async issueCorrection(cmd: IssueCorrectionCommand): Promise<InvoiceRecord> {
    const { originalProviderInvoiceId, reason, lines, documentType, idempotencyKey, orderId } =
      cmd;

    // Fetch original to build the before/after service arrays
    const original = await this.http.get<InfaktInvoice>(
      `invoices/${originalProviderInvoiceId}.json`,
      { invoice_type: 'vat' },
    );

    // Build correction services: original row (correction: false) + corrected row (correction: true)
    const correctionServices = original.services.flatMap((svc, idx) => {
      const corrLine = lines.find((l) => l.originalLineNumber === idx + 1);
      const corrQty = corrLine?.newQuantity ?? svc.quantity;
      const corrPrice = corrLine?.newUnitPriceGross
        ? `${corrLine.newUnitPriceGross} PLN`
        : `${svc.unit_net_price} PLN`;
      return [
        // Original "before" row
        {
          name: svc.name,
          tax_symbol: svc.tax_symbol,
          quantity: svc.quantity,
          unit: svc.unit ?? 'szt.',
          unit_net_price: `${svc.unit_net_price} PLN`,
          group: idx + 1,
          correction: false,
        },
        // Corrected "after" row
        {
          name: svc.name,
          tax_symbol: svc.tax_symbol,
          quantity: corrQty,
          unit: svc.unit ?? 'szt.',
          unit_net_price: corrPrice,
          group: idx + 1,
          correction: true,
        },
      ];
    });

    const payload = {
      invoice: {
        kind: 'corrective',
        payment_method: 'cash',
        corrected_invoice_number: original.number,
        corrected_invoice_date: original.invoice_date ?? new Date().toISOString().slice(0, 10),
        correction_reason_symbol: 'other',
        correction_reason: reason ?? 'Korekta',
        services: correctionServices,
        ...(idempotencyKey ? { external_id: idempotencyKey } : {}),
      },
    };

    // InfaktApiError carries `failureMode`; propagate as-is (see issueInvoice).
    const invoice = await this.http.post<InfaktInvoice>('invoices.json', payload);

    this.logger.log(`Infakt correction created: ${invoice.uuid} (${invoice.number ?? 'draft'})`);
    const now = new Date();
    return new InvoiceRecord(
      randomUUID(),
      this.connectionId,
      orderId,
      INFAKT_PROVIDER_TYPE,
      documentType ?? 'corrected',
      'issued',
      invoice.uuid,
      invoice.number ?? null,
      'not-applicable',
      null,
      idempotencyKey ?? null,
      invoice.pdf_url ?? null,
      now,
      null,
      now,
      now,
    );
  }

  // --- Infakt-specific: trigger KSeF submission ---

  async sendToKsef(invoiceUuid: string): Promise<InfaktSendToKsefResponse> {
    return this.http.post<InfaktSendToKsefResponse>(
      `invoices/${invoiceUuid}/send_to_ksef.json`,
      {},
    );
  }

  // --- helpers ---

  private async resolveClientUuid(cmd: IssueInvoiceCommand): Promise<string> {
    const result = await this.upsertCustomer({ connectionId: cmd.connectionId, buyer: cmd.buyer });
    return result.providerCustomerId;
  }

  private async findClientByNip(nip: string): Promise<InfaktClient | null> {
    try {
      const list = await this.http.get<InfaktListResponse<InfaktClient>>('clients.json', {
        nip,
      });
      return list.entities[0] ?? null;
    } catch {
      return null;
    }
  }

  private taxRateNumeric(taxRate: string): number {
    const n = parseFloat(taxRate);
    if (!isNaN(n) && n > 1) return n / 100;
    if (!isNaN(n)) return n;
    return 0;
  }
}

// Infakt requires invoice_type query param on GET; for POC we default to 'vat'
function invoice_uuid_kind(_uuid: string): string {
  return 'vat';
}
function invoice_kind_to_type(kind: string): string {
  return kind === 'corrective' ? 'corrective' : 'vat';
}
