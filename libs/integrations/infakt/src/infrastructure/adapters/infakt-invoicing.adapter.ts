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
  IssueInvoiceResult,
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
import type { InfaktConnectionConfig } from '../../domain/types/infakt-connection.types';

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

/** Maps neutral DocumentType → Infakt's GET-by-uuid `invoice_type` query param. */
function toInfaktInvoiceType(documentType: string): string {
  switch (documentType) {
    case 'corrected':
      return 'corrective';
    case 'proforma':
      return 'proforma';
    default:
      return 'vat';
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

/** Parses a tax-rate string (neutral `'23'`/`'0.23'` or Infakt `tax_symbol` `'zw'`/`'np'`) to a decimal fraction. */
function taxRateNumeric(taxRate: string): number {
  const n = parseFloat(taxRate);
  if (!isNaN(n) && n > 1) return n / 100;
  if (!isNaN(n)) return n;
  return 0;
}

/** Converts a buyer-paid gross unit price to Infakt's net unit price for the given tax rate. */
function grossToNet(unitPriceGross: number, taxRate: string): number {
  return unitPriceGross / (1 + taxRateNumeric(taxRate));
}

/** Parses Infakt's "amount currency" monetary string (e.g. "123.00 PLN") to a number. */
function parseInfaktAmount(value: string): number {
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
}

export class InfaktInvoicingAdapter
  implements InvoicingPort, RegulatoryStatusReader, CorrectionIssuer
{
  /**
   * Payment method sent on every issued invoice/correction (#1303) — a
   * single per-connection setting both `issueInvoice` and `issueCorrection`
   * read, so they can never disagree with each other again. Defaults to
   * `'cash'` (production-safe, no prerequisite) when the connection has no
   * `defaultPaymentMethod` configured. See
   * `InfaktConnectionConfig.defaultPaymentMethod` for the `'transfer'`
   * bank-account prerequisite.
   */
  private readonly paymentMethod: NonNullable<InfaktConnectionConfig['defaultPaymentMethod']>;

  constructor(
    private readonly connectionId: string,
    private readonly http: IInfaktHttpClient,
    private readonly logger: LoggerPort,
    config: InfaktConnectionConfig = {},
  ) {
    this.paymentMethod = config.defaultPaymentMethod ?? 'cash';
  }

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

  async issueInvoice(cmd: IssueInvoiceCommand): Promise<IssueInvoiceResult> {
    const { lines, currency, documentType, idempotencyKey, orderId } = cmd;
    const clientUuid = await this.resolveClientUuid(cmd);

    const kind = documentType === 'proforma' ? 'proforma' : 'vat';
    const services = lines.map((l) => ({
      name: l.name,
      tax_symbol: toInfaktTaxSymbol(l.taxRate),
      quantity: l.quantity,
      unit: 'szt.',
      unit_net_price: `${grossToNet(l.unitPriceGross, l.taxRate).toFixed(2)} ${currency ?? 'PLN'}`,
    }));

    const payload = {
      invoice: {
        kind,
        // Per-connection setting (#1303) — see `this.paymentMethod` doc.
        payment_method: this.paymentMethod,
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
    const record = new InvoiceRecord(
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
    // Infakt has no separate seller-profile lookup or a source-document Infakt
    // builds itself (it submits to KSeF natively) — `IssueInvoiceResult`'s
    // optional `seller`/`sourceDocument` are for adapters that build their own
    // fiscal document (e.g. KSeF's FA(3) XML); Infakt omits both.
    return { record };
  }

  async getInvoice(query: GetInvoiceQuery): Promise<InvoiceRecord | null> {
    const providerInvoiceId =
      'providerInvoiceId' in query ? query.providerInvoiceId : null;
    if (!providerInvoiceId) {
      // orderId-based lookup not supported by Infakt; must go via OL's own store
      return null;
    }

    // Kind is unknown ahead of the lookup (no InvoiceRecord to read documentType
    // from); try the two kinds this adapter issues (`vat`, `corrective`) in turn.
    for (const invoiceType of ['vat', 'corrective']) {
      try {
        const invoice = await this.http.get<InfaktInvoice>(
          `invoices/${providerInvoiceId}.json`,
          { invoice_type: invoiceType },
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
        if (err instanceof InfaktApiError && err.statusCode === 404) continue;
        throw err;
      }
    }
    return null;
  }

  async getClearanceStatus(record: InvoiceRecord): Promise<RegulatoryClearanceResult> {
    if (!record.providerInvoiceId) {
      return { regulatoryStatus: 'not-applicable' };
    }

    const invoice = await this.http.get<InfaktInvoice>(
      `invoices/${record.providerInvoiceId}.json`,
      { invoice_type: toInfaktInvoiceType(record.documentType) },
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

    // Infakt's InfaktInvoice type carries no currency field (accounts are
    // single-currency in practice); PLN mirrors issueInvoice's own default
    // and is the only value Infakt sandbox/production has ever returned here.
    const currency = 'PLN';

    // Build correction services: original row (correction: false) + corrected row (correction: true)
    const correctionServices = original.services.flatMap((svc, idx) => {
      const corrLine = lines.find((l) => l.originalLineNumber === idx + 1);
      const corrQty = corrLine?.newQuantity ?? svc.quantity;
      // Infakt returns unit_net_price as an "amount currency" string (e.g.
      // "100.00 PLN"), never a plain number — confirmed against the v3
      // schema (#1292 review) — so it must be parsed before arithmetic.
      const originalNet = parseInfaktAmount(svc.unit_net_price);
      // newUnitPriceGross is gross (IssueCorrectionCommand contract); Infakt's
      // unit_net_price is net — convert using the ORIGINAL line's tax_symbol,
      // same as issueInvoice's gross→net conversion (#1292 review).
      const corrPrice = corrLine?.newUnitPriceGross
        ? `${grossToNet(corrLine.newUnitPriceGross, svc.tax_symbol).toFixed(2)} ${currency}`
        : `${originalNet.toFixed(2)} ${currency}`;
      return [
        // Original "before" row
        {
          name: svc.name,
          tax_symbol: svc.tax_symbol,
          quantity: svc.quantity,
          unit: svc.unit ?? 'szt.',
          unit_net_price: `${originalNet.toFixed(2)} ${currency}`,
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
        // Per-connection setting (#1303) — see `this.paymentMethod` doc.
        payment_method: this.paymentMethod,
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
}
