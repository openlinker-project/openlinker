/**
 * Infakt Invoicing Adapter
 *
 * Implements `InvoicingPort`, `RegulatoryStatusReader`, and `CorrectionIssuer`
 * over the Infakt REST API v3. PL-specific logic (NIP mapping, ksef_data polling,
 * paragon vs faktura) stays here — never bleeds into libs/core.
 *
 * KSeF model: `issueInvoice`/`issueCorrection` create the draft in Infakt AND
 * explicitly trigger `send_to_ksef.json` inline, one atomic step — verified
 * live (2026-07-01): an Infakt draft does NOT auto-submit to KSeF on its own,
 * so this call is required or the document sits in `draft` forever. Infakt
 * still builds the FA(3) XML and owns the KSeF session itself (OL never
 * touches FA(3)); `getClearanceStatus` reads `ksef_data.status` for later
 * polling. This is why the adapter implements `RegulatoryStatusReader`
 * (read-only clearance poll), NOT `RegulatoryTransmitter` (which implies OL
 * itself holds the active KSeF session).
 *
 * @module libs/integrations/infakt/src/infrastructure/adapters
 */
import { randomUUID } from 'crypto';
import type { LoggerPort } from '@openlinker/shared/logging';
import type {
  BankAccountDefaultSetter,
  BankAccountsReader,
  CorrectionIssuer,
  DocumentType,
  GetInvoiceQuery,
  InvoiceEmailLocale,
  InvoiceEmailSender,
  InvoicingBankAccount,
  IssueCorrectionCommand,
  IssueInvoiceCommand,
  IssueInvoiceResult,
  InvoicingPort,
  PaymentStatus,
  PaymentStatusReader,
  PaymentStatusResult,
  RegulatoryClearanceResult,
  RegulatoryDocument,
  RegulatoryDocumentKind,
  RegulatoryDocumentReader,
  RegulatoryResubmitter,
  RegulatoryStatus,
  RegulatoryStatusReader,
  SendInvoiceByEmailCommand,
  SendInvoiceByEmailResult,
  UpsertCustomerCommand,
  UpsertCustomerResult,
} from '@openlinker/core/invoicing';
import { InvoiceRecord, UnsupportedRegulatoryDocumentKindError } from '@openlinker/core/invoicing';
import type { IInfaktHttpClient } from '../http/infakt-http-client.interface';
import { InfaktApiError } from '../../domain/exceptions/infakt-api.error';
import type {
  InfaktBankAccount,
  InfaktClient,
  InfaktCorrectiveInvoiceServiceRequest,
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

/**
 * Maps Infakt ksef_data.status → neutral RegulatoryStatus.
 *
 * `success` is the TERMINAL accepted state — it must map to `accepted`, not
 * `cleared`. `cleared` is reserved for split-clearance regimes (no current
 * provider emits it) and the FE's status card only branches on
 * `submitted`/`accepted`/`rejected`, so a `cleared` mapping here left the
 * badge permanently stuck at "CLEARING" and hid the clearance-reference chip
 * even once the invoice had genuinely cleared on the government side
 * (#1293 review, live E2E finding). Mirrors KSeF's own adapter, which maps
 * its terminal 200 status to `accepted` for the exact same reason.
 */
function toRegulatoryStatus(ksefStatus: InfaktKsefStatus | null | undefined): RegulatoryStatus {
  if (!ksefStatus) return 'not-applicable';
  switch (ksefStatus) {
    case 'pending':
    case 'sent':
      return 'submitted';
    case 'success':
      return 'accepted';
    case 'error':
      return 'rejected';
  }
}

/**
 * The Infakt settlement tokens this adapter recognises, verified against the
 * two Infakt meta dictionaries (live 2026-07):
 *   - invoice `status` (`invoice_statuses`): `draft` | `sent` | `printed` | `paid`
 *   - payment status (`payment_statuses`):  `paid` | `unpaid` | `partial_payment`
 *                                           | `payment_not_applicable`
 *
 * `toPaymentStatus` reads only `InfaktInvoice.status` — the `invoice_statuses`
 * field, which carries `paid` but has *no* partial token today. So the
 * `partial`/`partly` match below is a forward-looking guard, not a currently
 * reachable branch: it's here so that if Infakt ever surfaces a settlement token
 * on `status` (or the field is later widened to the `payment_statuses`
 * vocabulary, whose `partial_payment` it would then catch), a part-settled
 * document classifies as `partially-paid` rather than silently `unpaid`.
 * Matching against known tokens (rather than a bare `=== 'paid'`) keeps that
 * drift explicit here instead of mis-classifying.
 */
const INFAKT_PAID_TOKENS: readonly string[] = ['paid'];
const INFAKT_PARTIAL_TOKENS: readonly string[] = ['partial', 'partly'];

/**
 * Maps Infakt's invoice `status` (+ `paid_date`) → neutral PaymentStatus (#1354).
 *
 * Precedence: an explicit `paid` token wins; a `partial`/`partly` token is
 * part-settled; a present `paid_date` with any other status is a defensive
 * fallback to `paid` (Infakt only stamps that date once the document is
 * settled); everything else (`draft`/`sent`/`printed`/…) is `unpaid`.
 */
function toPaymentStatus(invoice: InfaktInvoice): PaymentStatus {
  const status = (invoice.status ?? '').toLowerCase();
  if (INFAKT_PAID_TOKENS.includes(status)) return 'paid';
  if (INFAKT_PARTIAL_TOKENS.some((token) => status.includes(token))) return 'partially-paid';
  if (invoice.paid_date) return 'paid';
  return 'unpaid';
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

/**
 * Maps the neutral email-delivery locale (#1353) → the `locale` field of
 * inFakt's `deliver_via_email` payload (`pl` / `en`; bilingual variants exist
 * but are out of scope for the neutral pl/en choice). Returns `undefined`
 * when the caller left it unset, so the request omits `locale` and inFakt
 * uses its own per-account default.
 */
function toInfaktEmailLocale(locale: InvoiceEmailLocale | undefined): string | undefined {
  switch (locale) {
    case 'pl':
      return 'pl';
    case 'en':
      return 'en';
    case undefined:
      return undefined;
  }
}

/**
 * Poland's standard VAT rate — the "regime rate" the adapter is documented
 * (`order-to-issue-invoice-command.mapper.ts`) to resolve when core leaves
 * `InvoiceLine.taxRate` empty, which it always does today (core never names
 * a tax rate on the order contract). Verified live (2026-07-01): an empty
 * `tax_symbol` doesn't just get rejected on its own field — Infakt cascades
 * it into `services.gross` / `value.tax_values` errors too, so EVERY line on
 * EVERY invoice 422'd before this fallback existed.
 */
const DEFAULT_PL_VAT_SYMBOL = '23';
const DEFAULT_PL_VAT_RATE = 0.23;

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
      return taxRate.trim() === '' ? DEFAULT_PL_VAT_SYMBOL : taxRate;
  }
}

/**
 * Parses a tax-rate string (neutral `'23'`/`'0.23'` or Infakt `tax_symbol`
 * `'zw'`/`'np'`) to a decimal fraction.
 *
 * Must stay consistent with `toInfaktTaxSymbol`'s empty-string fallback — a
 * mismatched net/gross split for the declared tax_symbol is itself rejected
 * by Infakt as an invalid `value.tax_values`.
 */
function taxRateNumeric(taxRate: string): number {
  if (taxRate.trim() === '') return DEFAULT_PL_VAT_RATE;
  const n = parseFloat(taxRate);
  if (!isNaN(n) && n > 1) return n / 100;
  if (!isNaN(n)) return n;
  return 0;
}

/** Converts a buyer-paid gross unit price (PLN) to Infakt's net unit price (PLN) for the given tax rate. */
function grossToNet(unitPriceGross: number, taxRate: string): number {
  return unitPriceGross / (1 + taxRateNumeric(taxRate));
}

/**
 * Converts a PLN amount to Infakt's wire format: a plain integer count of
 * groszy (1 PLN = 100 groszy). Confirmed both live against the real sandbox
 * and against the official API schema — `unit_net_price`/`net_price`/
 * `gross_price` are `integer`, documented "w groszach". Sending a decimal
 * "amount currency" string here (the previous behaviour) understated every
 * invoice's legal/KSeF amount ~100x (#1293 review).
 */
function toGroszy(amountPln: number): number {
  return Math.round(amountPln * 100);
}

/** Converts an Infakt wire amount (plain integer groszy) back to a PLN decimal for arithmetic. */
function fromGroszy(amountGroszy: number): number {
  return amountGroszy / 100;
}

/**
 * Converts an integer-groszy amount to the corrective_invoices.json wire
 * format: a dot-decimal "amount currency" STRING like `"811.37 PLN"`.
 * Verified live (2026-07-03): corrective_invoices.json 500s on the
 * invoices.json integer-groszy shape — the two endpoints' formats DIFFER.
 *
 * PLN-only assumption: the currency suffix is hardcoded to " PLN" because
 * inFakt is a Polish-only provider and `InfaktInvoice` carries no currency
 * field to read a per-document currency from.
 */
function groszyToAmountString(amountGroszy: number): string {
  return `${(amountGroszy / 100).toFixed(2)} PLN`;
}

/**
 * A record with neutral `documentType: 'corrected'` is an Infakt CORRECTIVE
 * invoice — a distinct resource living under `corrective_invoices/…`, NOT
 * `invoices/…` (verified live, 2026-07-03: `GET /invoices/{uuid}.json`
 * returns 404 for corrective uuids). Every read/submit path keyed on
 * `providerInvoiceId` must branch on this.
 */
function isCorrectionRecord(documentType: string): boolean {
  return documentType === 'corrected';
}

export class InfaktInvoicingAdapter
  implements
    InvoicingPort,
    RegulatoryStatusReader,
    PaymentStatusReader,
    RegulatoryResubmitter,
    CorrectionIssuer,
    RegulatoryDocumentReader,
    BankAccountsReader,
    BankAccountDefaultSetter,
    InvoiceEmailSender
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

  /**
   * Bank account stamped on `'transfer'` invoices (#1303 follow-up) — a
   * snapshot chosen by the operator via `listBankAccounts()`, not re-fetched
   * at issuance time. `undefined` when the operator hasn't picked one (or
   * picked Cash) — `issueInvoice`/`issueCorrection` then omit the
   * `bank_account`/`bank_name` fields entirely.
   */
  private readonly bankAccount: InfaktConnectionConfig['bankAccount'];

  constructor(
    private readonly connectionId: string,
    private readonly http: IInfaktHttpClient,
    private readonly logger: LoggerPort,
    config: InfaktConnectionConfig = {},
  ) {
    this.paymentMethod = config.defaultPaymentMethod ?? 'cash';
    this.bankAccount = config.bankAccount;
  }

  /**
   * List the seller's payable bank accounts known to inFakt (#1303 follow-up).
   *
   * Reads only the FIRST page of `bank_accounts.json` (inFakt's default page
   * size, 10) — accepted v1 scope: sellers realistically hold a handful of
   * accounts, and the picker degrades gracefully (the saved snapshot keeps
   * being stamped) if one ever falls off the page.
   */
  async listBankAccounts(): Promise<InvoicingBankAccount[]> {
    const response = await this.getListResponse<InfaktBankAccount>('bank_accounts.json');
    return response.items.map((account) => ({
      id: String(account.id),
      accountNumber: account.account_number,
      bankName: account.bank_name,
      isDefault: account.default,
    }));
  }

  /**
   * Mark `accountId` as the seller's default bank account in inFakt itself
   * (#1303 follow-up) — keeps inFakt's own "default account" setting (visible
   * in the seller's inFakt UI) in sync with the account OpenLinker stamps on
   * `'transfer'` invoices, so the two never disagree about which account is
   * "the" default. PUTs `{ default: true }` on the new account only — inFakt
   * clears the previous default server-side, so no second call is needed.
   */
  async setDefaultBankAccount(accountId: string): Promise<void> {
    await this.http.put(`bank_accounts/${encodeURIComponent(accountId)}.json`, {
      bank_account: { default: true },
    });
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
        this.logger.log(`Infakt client found by NIP ${nip}: ${existing.id}`);
        return { providerCustomerId: String(existing.id) };
      }
    }

    // Create new client. Field names verified live against the sandbox
    // (2026-07-01): the API wants `company_name` / `postal_code`, not the
    // `name` / `post_code` this previously sent — the latter is silently
    // rejected/ignored, so first-time client creation always 422'd.
    const payload = {
      client: {
        company_name: buyer.name,
        nip: nip ?? undefined,
        city: buyer.address.city,
        street: buyer.address.line1,
        postal_code: buyer.address.postalCode,
        country: buyer.address.countryIso2,
      },
    };

    // InfaktApiError carries `failureMode`; propagate as-is (see issueInvoice).
    const created = await this.http.post<InfaktClient>('clients.json', payload);
    this.logger.log(`Infakt client created: ${created.id}`);
    return { providerCustomerId: String(created.id) };
  }

  async issueInvoice(cmd: IssueInvoiceCommand): Promise<IssueInvoiceResult> {
    const { lines, documentType, idempotencyKey, orderId } = cmd;
    const clientId = await this.resolveClientId(cmd);

    const kind = documentType === 'proforma' ? 'proforma' : 'vat';
    const services = lines.map((l) => ({
      name: l.name,
      tax_symbol: toInfaktTaxSymbol(l.taxRate),
      quantity: l.quantity,
      unit: 'szt.',
      // Plain integer groszy, NOT an "amount currency" string — see toGroszy.
      unit_net_price: toGroszy(grossToNet(l.unitPriceGross, l.taxRate)),
    }));

    const payload = {
      invoice: {
        kind,
        // Per-connection setting (#1303) — see `this.paymentMethod` doc.
        payment_method: this.paymentMethod,
        // Infakt's invoices.json wants the NUMERIC client id, not the client
        // uuid — verified live (2026-07-01): `client_uuid` is silently
        // ignored and the request 422s with "client_id required".
        client_id: clientId,
        services,
        ...this.bankAccountFields(),
        ...(idempotencyKey ? { external_id: idempotencyKey } : {}),
      },
    };

    // InfaktApiError carries the neutral `failureMode` discriminator core's
    // InvoiceService reads structurally (#1200) — propagate as-is rather
    // than wrapping into a plain Error, which would erase that signal.
    const invoice = await this.http.post<InfaktInvoice>('invoices.json', payload);

    this.logger.log(`Infakt invoice created: ${invoice.uuid} (${invoice.number ?? 'draft'})`);

    // Issuing does NOT submit to KSeF on its own — verified live (2026-07-01):
    // an Infakt invoice sits in `draft` (KSeF-untouched) forever unless
    // send_to_ksef.json is called explicitly. Mirrors how KSeF's own
    // `issueInvoice` submits inline (build → session → submit, one atomic
    // step) and how Subiekt "transmits to KSeF natively at issuance" — for
    // Infakt that native transmission requires this explicit kick, so it
    // belongs in the same place: issuing IS submitting.
    //
    // Retry-safety assumption (unverified — #1293 review): if this call
    // throws (network/API error), the draft above was already created and
    // this whole method rejects, so core treats issuance as failed. A caller
    // retry re-invokes issueInvoice, which re-POSTs invoices.json with the
    // SAME external_id (idempotencyKey). We rely on Infakt returning/reusing
    // the same invoice uuid for a repeat external_id rather than creating a
    // duplicate draft — that would make this second sendToKsef call a safe
    // re-attempt on the same document. This dedup behaviour has not been
    // confirmed against the live API; if Infakt instead creates a new draft
    // per POST, a failed sendToKsef leaves an orphaned un-submitted document
    // on every retry.
    const ksefResult = await this.sendToKsef(invoice.uuid);

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
      toRegulatoryStatus(ksefResult.status),
      ksefResult.ksef_number,
      idempotencyKey ?? null,
      // Infakt's invoice resource carries no `pdf_url` field (verified live
      // against the sandbox, #1321) — the real PDF path is
      // `RegulatoryDocumentReader.getRegulatoryDocument(record, 'rendered')`
      // below, which hits the dedicated `pdf.json` endpoint.
      null,
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

    // Kind is unknown ahead of the lookup (no InvoiceRecord to read
    // documentType from), and corrective documents live under a DIFFERENT
    // resource — `GET /invoices/{uuid}.json` 404s for corrective uuids
    // (verified live, 2026-07-03). Try the plain-invoice path first, then
    // fall back to `corrective_invoices/{uuid}.json`.
    const lookups: ReadonlyArray<{ path: string; query?: Record<string, string> }> = [
      {
        path: `invoices/${encodeURIComponent(providerInvoiceId)}.json`,
        query: { invoice_type: 'vat' },
      },
      { path: `corrective_invoices/${encodeURIComponent(providerInvoiceId)}.json` },
    ];
    for (const lookup of lookups) {
      try {
        const invoice = await this.http.get<InfaktInvoice>(lookup.path, lookup.query);
        const now = new Date();
        return new InvoiceRecord(
          randomUUID(),
          this.connectionId,
          '',
          INFAKT_PROVIDER_TYPE,
          invoice.kind === 'corrective' || invoice.kind === 'correction' ? 'corrected' : 'invoice',
          'issued',
          invoice.uuid,
          invoice.number ?? null,
          toRegulatoryStatus(invoice.ksef_data?.status ?? null),
          invoice.ksef_data?.ksef_number ?? null,
          null,
          // Infakt's invoice resource carries no `pdf_url` field (verified live
          // against the sandbox, #1321) — the real PDF path is
          // `RegulatoryDocumentReader.getRegulatoryDocument(record, 'rendered')`
          // below, which hits the dedicated `pdf.json` endpoint.
          null,
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

    // Corrective documents are a distinct resource — the invoices/… path 404s
    // for corrective uuids (verified live, 2026-07-03), so the reconcile job's
    // poll must branch on the record's documentType.
    const invoice = isCorrectionRecord(record.documentType)
      ? await this.http.get<InfaktInvoice>(
          `corrective_invoices/${encodeURIComponent(record.providerInvoiceId)}.json`,
        )
      : await this.http.get<InfaktInvoice>(
          `invoices/${encodeURIComponent(record.providerInvoiceId)}.json`,
          {
            invoice_type: toInfaktInvoiceType(record.documentType),
          },
        );

    const ksefData = invoice.ksef_data;
    return {
      regulatoryStatus: toRegulatoryStatus(ksefData?.status ?? null),
      clearanceReference: ksefData?.ksef_number ?? null,
    };
  }

  /**
   * `PaymentStatusReader.getPaymentStatus` (#1354) — authoritative re-read of the
   * document's payment state. A provider payment webhook is only a trigger; core
   * calls this to read the real state rather than trusting the webhook body.
   * Returns `unknown` when the record has no provider id (nothing to read).
   */
  async getPaymentStatus(record: InvoiceRecord): Promise<PaymentStatusResult> {
    if (!record.providerInvoiceId) {
      return { paymentStatus: 'unknown' };
    }

    const invoice = await this.http.get<InfaktInvoice>(
      `invoices/${record.providerInvoiceId}.json`,
      { invoice_type: toInfaktInvoiceType(record.documentType) },
    );

    return { paymentStatus: toPaymentStatus(invoice) };
  }

  async issueCorrection(cmd: IssueCorrectionCommand): Promise<IssueInvoiceResult> {
    const { originalProviderInvoiceId, reason, lines, documentType, idempotencyKey, orderId } =
      cmd;

    // Fetch original to build the before/after service arrays
    const original = await this.http.get<InfaktInvoice>(
      `invoices/${encodeURIComponent(originalProviderInvoiceId)}.json`,
      { invoice_type: 'vat' },
    );

    // Build correction services: original row (correction: false) + corrected
    // row (correction: true), paired per `group`. NOTE the wire formats:
    // corrective_invoices.json wants a decimal "amount currency" STRING for
    // `unit_net_price` and a STRING `quantity` — the invoices.json
    // integer-groszy / numeric shapes 500 here (verified live, 2026-07-03).
    const correctionServices: InfaktCorrectiveInvoiceServiceRequest[] =
      original.services.flatMap((svc, idx) => {
        const corrLine = lines.find((l) => l.originalLineNumber === idx + 1);
        const corrQty = corrLine?.newQuantity ?? svc.quantity;
        // svc.unit_net_price is a plain integer groszy (Infakt wire format —
        // see toGroszy/fromGroszy) — convert to a PLN decimal before arithmetic.
        const originalNet = fromGroszy(svc.unit_net_price);
        // newUnitPriceGross is gross (IssueCorrectionCommand contract); Infakt's
        // unit_net_price is net — convert using the ORIGINAL line's tax_symbol,
        // same as issueInvoice's gross→net conversion (#1292 review).
        // `!= null` (not truthy) so a correction to 0.00 PLN is honoured
        // instead of silently falling back to the original price (#1342 review).
        const corrPriceGroszy =
          corrLine?.newUnitPriceGross != null
            ? toGroszy(grossToNet(corrLine.newUnitPriceGross, svc.tax_symbol))
            : toGroszy(originalNet);
        const shared = {
          name: svc.name,
          tax_symbol: svc.tax_symbol,
          unit: svc.unit ?? 'szt.',
          group: String(idx + 1),
        };
        return [
          // Original "before" row
          {
            ...shared,
            quantity: String(svc.quantity),
            unit_net_price: groszyToAmountString(toGroszy(originalNet)),
            correction: false,
          },
          // Corrected "after" row
          {
            ...shared,
            quantity: String(corrQty),
            unit_net_price: groszyToAmountString(corrPriceGroszy),
            correction: true,
          },
        ];
      });

    // Corrections go to the DEDICATED corrective_invoices.json endpoint with
    // the `corrective_invoice` wrapper key (#1337) — posting a
    // `kind: 'corrective'` payload to invoices.json makes Infakt SILENTLY
    // ignore every correction field and create a plain, unlinked VAT invoice
    // (verified live, 2026-07-03). Fiscally wrong, hence the belt-and-
    // suspenders kind check below too.
    const payload = {
      corrective_invoice: {
        // Per-connection setting (#1303) — see `this.paymentMethod` doc.
        payment_method: this.paymentMethod,
        // Required by Infakt on every invoice, corrective included — verified
        // live (2026-07-01): omitting it 422s with "client_id required". The
        // original invoice already carries the numeric id, so no extra
        // upsertCustomer round-trip is needed for a correction.
        client_id: original.client_id,
        ...this.bankAccountFields(),
        corrected_invoice_number: original.number,
        corrected_invoice_date: original.invoice_date ?? new Date().toISOString().slice(0, 10),
        correction_reason_symbol: 'other',
        correction_reason: reason ?? 'Korekta',
        services: correctionServices,
        ...(idempotencyKey ? { external_id: idempotencyKey } : {}),
      },
    };

    // InfaktApiError carries `failureMode`; propagate as-is (see issueInvoice).
    const invoice = await this.http.post<InfaktInvoice>('corrective_invoices.json', payload);

    // Belt-and-suspenders for the silent-downgrade class of bug (#1337): if
    // the provider created anything other than a real correction, fail loudly
    // instead of persisting a record that claims a corrective linkage the
    // document doesn't have. Status 502 (not 4xx) is deliberate: a document WAS
    // created here (just of the wrong kind), so this is `failureMode: 'in-doubt'`
    // — a 4xx `'rejected'` would tell core "no document exists, safe to
    // re-attempt", which could spawn a SECOND orphaned corrective on retry
    // (the corrective external_id dedup is unverified — see the retry-safety
    // note below). `in-doubt` forces manual review instead of an auto-retry loop.
    // NOTE: the expected *response* kind is 'correction' (not 'corrective') —
    // don't loosen this check to accept 'corrective' as a "fix".
    if (invoice.kind !== 'correction') {
      throw new InfaktApiError(
        `Infakt returned kind "${invoice.kind}" instead of "correction" for corrective_invoices.json — document ${invoice.uuid} is not a correction of ${original.number ?? originalProviderInvoiceId}`,
        502,
        invoice,
      );
    }

    this.logger.log(`Infakt correction created: ${invoice.uuid} (${invoice.number ?? 'draft'})`);

    // A correction is its own KSeF document (KOR) — it needs the same explicit
    // submission kick as the original (see issueInvoice), but through the
    // corrective resource: `invoices/{uuid}/send_to_ksef.json` 404s for
    // corrective uuids (verified live, 2026-07-03).
    //
    // Same retry-safety assumption as issueInvoice (unverified — #1293
    // review): a retry re-calls issueCorrection, which re-POSTs
    // corrective_invoices.json with the same external_id; we rely on Infakt
    // returning/reusing the same correction uuid rather than creating a
    // second corrective draft, which would make this sendToKsef call a safe
    // re-attempt on the same document.
    const ksefResult = await this.sendToKsef(invoice.uuid, 'corrective_invoices');

    const now = new Date();
    return {
      record: new InvoiceRecord(
        randomUUID(),
        this.connectionId,
        orderId,
        INFAKT_PROVIDER_TYPE,
        documentType ?? 'corrected',
        'issued',
        invoice.uuid,
        invoice.number ?? null,
        toRegulatoryStatus(ksefResult.status),
        ksefResult.ksef_number,
        idempotencyKey ?? null,
        // Infakt's invoice resource carries no `pdf_url` field (verified live
        // against the sandbox, #1321) — the real PDF path is
        // `RegulatoryDocumentReader.getRegulatoryDocument(record, 'rendered')`
        // below, which hits the dedicated `pdf.json` endpoint.
        null,
        now,
        null,
        now,
        now,
      ),
      // Infakt builds and owns its own FA(3)/KSeF session server-side (see the
      // module docstring) — there is no machine-readable document for OL to
      // capture, same as issueInvoice.
    };
  }

  // --- Infakt-specific: trigger KSeF submission ---
  // Called inline by issueInvoice/issueCorrection (issuing IS submitting for
  // this provider). Public: already called directly by
  // scripts/poc-sandbox-test.ts, and kept accessible so a future
  // operator-facing manual re-submit can reuse it without a second code path.

  /**
   * `resource` selects the REST resource the document lives under — a
   * corrective invoice's submit path is `corrective_invoices/{uuid}/
   * send_to_ksef.json`; the invoices/… path 404s for corrective uuids
   * (verified live, 2026-07-03).
   */
  async sendToKsef(
    invoiceUuid: string,
    resource: 'invoices' | 'corrective_invoices' = 'invoices',
  ): Promise<InfaktSendToKsefResponse> {
    return this.http.post<InfaktSendToKsefResponse>(
      `${resource}/${encodeURIComponent(invoiceUuid)}/send_to_ksef.json`,
      {},
    );
  }

  /**
   * `RegulatoryResubmitter.resubmitForClearance` (#1356) — re-trigger KSeF
   * submission of an ALREADY-ISSUED inFakt document, for the operator "resend to
   * KSeF" action on a rejected invoice.
   *
   * Retry-safety (confirms/guards the previously-UNVERIFIED note on repeated
   * `send_to_ksef` above): unlike `issueInvoice`/`issueCorrection`, this path
   * does NOT re-POST `invoices.json`, so it can never create a second draft. It
   * only re-hits `send_to_ksef.json` for the SAME existing document identified by
   * `record.providerInvoiceId` — a pure re-transmission of a document inFakt
   * already holds. The caller (the HTTP layer) additionally gates the action to
   * documents whose clearance ended in `rejected`, so an in-flight or already-
   * accepted document is never re-sent. Together these make a repeat
   * `send_to_ksef` a safe re-attempt on one and the same fiscal document — it
   * cannot double-issue. inFakt's async model returns the fresh submission status
   * here (typically `pending`/`sent` → neutral `submitted`); OL's reconciliation
   * sweep (#1121) then polls it to a terminal state.
   *
   * `providerInvoiceId` is always present for an issued record; the defensive
   * `not-applicable` return covers a malformed record rather than a real path.
   */
  async resubmitForClearance(record: InvoiceRecord): Promise<RegulatoryClearanceResult> {
    if (!record.providerInvoiceId) {
      return { regulatoryStatus: 'not-applicable' };
    }
    const ksefResult = await this.sendToKsef(record.providerInvoiceId);
    return {
      regulatoryStatus: toRegulatoryStatus(ksefResult.status),
      clearanceReference: ksefResult.ksef_number ?? null,
    };
  }

  /**
   * `InvoiceEmailSender.sendByEmail` (#1353) — trigger inFakt to render + email
   * the already-issued invoice to the buyer via
   * `POST /invoices/{uuid}/deliver_via_email.json`. inFakt composes and sends
   * the message itself (OL attaches nothing) and flips the invoice status to
   * `sent` on its side. `print_type: 'original'` is the standard document view;
   * `locale` is sent only when the operator picked one (else inFakt's account
   * default); `send_copy` asks inFakt to CC the seller. There is no recipient
   * override — inFakt always uses the client's stored email, so the response
   * `recipient` is always null (inFakt doesn't echo it back). A provider
   * rejection propagates as-is (the controller maps it to a 502).
   */
  async sendByEmail(cmd: SendInvoiceByEmailCommand): Promise<SendInvoiceByEmailResult> {
    const locale = toInfaktEmailLocale(cmd.locale);
    const payload = {
      print_type: 'original',
      ...(locale ? { locale } : {}),
      ...(cmd.sendCopy !== undefined ? { send_copy: cmd.sendCopy } : {}),
    };
    await this.http.post(
      `invoices/${encodeURIComponent(cmd.externalInvoiceId)}/deliver_via_email.json`,
      payload,
    );
    this.logger.log(`Infakt invoice ${cmd.externalInvoiceId} emailed to buyer`);
    return { delivered: true, recipient: null };
  }

  /**
   * `RegulatoryDocumentReader.getRegulatoryDocument` (#1321) — fetch the
   * invoice PDF as neutral bytes. Infakt has no `pdf_url` field on the
   * invoice resource (verified live against the sandbox); the real path is
   * the dedicated `GET /invoices/{uuid}/pdf.json` endpoint, which returns the
   * PDF binary directly. Infakt submits to KSeF natively and OL never builds
   * or holds a KSeF confirmation (UPO) for this provider, so only `rendered`
   * is supported — `confirmation`/`source` are soft 409s via
   * `UnsupportedRegulatoryDocumentKindError`, mirroring KSeF's own adapter
   * rejecting `rendered` the other way around.
   */
  async getRegulatoryDocument(
    record: InvoiceRecord,
    kind: RegulatoryDocumentKind = 'confirmation',
  ): Promise<RegulatoryDocument> {
    if (kind !== 'rendered') {
      throw new UnsupportedRegulatoryDocumentKindError(kind);
    }
    // A correction's PDF lives under its own resource, mirroring every other
    // corrective read path (`corrective_invoices/{uuid}/pdf.json` — the
    // invoices/… path 404s for corrective uuids). Kept structurally identical
    // to the invoice pdf.json call; not yet live-verified for corrections.
    const response = isCorrectionRecord(record.documentType)
      ? await this.http.getBinary(
          `corrective_invoices/${encodeURIComponent(String(record.providerInvoiceId))}/pdf.json`,
          { document_type: 'original' },
        )
      : await this.http.getBinary(
          `invoices/${encodeURIComponent(String(record.providerInvoiceId))}/pdf.json`,
          {
            document_type: 'original',
            invoice_type: toInfaktInvoiceType(record.documentType),
          },
        );
    return {
      content: response.data,
      contentType: response.contentType.length > 0 ? response.contentType : 'application/pdf',
    };
  }

  // --- helpers ---

  private async resolveClientId(cmd: IssueInvoiceCommand): Promise<number> {
    const result = await this.upsertCustomer({ connectionId: cmd.connectionId, buyer: cmd.buyer });
    return Number(result.providerCustomerId);
  }

  private async findClientByNip(nip: string): Promise<InfaktClient | null> {
    try {
      const list = await this.getListResponse<InfaktClient>('clients.json', { nip });
      return list.items[0] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Thin regression guard against a repeat of the #1373/#1374 envelope-shape
   * drift: `listBankAccounts`/`findClientByNip` both previously read
   * `response.entities` against a list endpoint that actually returns
   * `{ items, pagination }`, so a missing `items` array surfaced as an
   * `undefined.map()` `TypeError` — indistinguishable, once the controller
   * masks it into a generic 502, from an unreachable provider. Failing loudly
   * here with a named, path-specific `InfaktApiError` means a FUTURE wire-shape
   * drift logs a clear cause (`toProviderBadGateway` logs the thrown error's
   * message) instead of a bare "Cannot read properties of undefined".
   */
  private async getListResponse<T>(
    path: string,
    query?: Record<string, string>,
  ): Promise<InfaktListResponse<T>> {
    const response = await this.http.get<InfaktListResponse<T>>(path, query);
    if (!response || !Array.isArray(response.items)) {
      throw new InfaktApiError(
        `Infakt ${path} returned an unexpected envelope shape (expected { items: [...] })`,
        502,
        response,
      );
    }
    return response;
  }

  /**
   * `bank_account`/`bank_name` invoice fields (#1303 follow-up) — only sent
   * for `'transfer'` invoices with a configured `bankAccount` snapshot.
   * `'cash'` invoices never carry these regardless of what's configured, and
   * a `'transfer'` invoice with no configured account omits them too (the
   * pre-existing #1303 behavior: Infakt rejects the invoice, surfacing the
   * missing-prerequisite loudly rather than silently).
   */
  private bankAccountFields(): { bank_account: string; bank_name: string } | Record<string, never> {
    if (this.paymentMethod !== 'transfer' || !this.bankAccount) return {};
    return { bank_account: this.bankAccount.accountNumber, bank_name: this.bankAccount.bankName };
  }
}
