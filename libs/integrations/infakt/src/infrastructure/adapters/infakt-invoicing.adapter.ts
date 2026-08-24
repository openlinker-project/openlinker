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
  MarkInvoicePaidCommand,
  PaymentMarker,
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
import {
  assertPercentTaxRateNotation,
  taxRatePercentToFraction,
} from '@openlinker/core/invoicing';
import type { IssuedDocumentLineAmounts } from '@openlinker/core/invoicing';
import { MissingTaxRateException, findMissingTaxRate } from '@openlinker/core/invoicing';
import { isTaxRateEnforced } from '@openlinker/core/sales-documents';
import type { IInfaktHttpClient } from '../http/infakt-http-client.interface';
import { InfaktApiError } from '../../domain/exceptions/infakt-api.error';
import type {
  InfaktAsyncTaskAccepted,
  InfaktBankAccount,
  InfaktClient,
  InfaktClientRequest,
  InfaktCorrectiveInvoiceRequest,
  InfaktCorrectiveInvoiceServiceRequest,
  InfaktInvoice,
  InfaktInvoiceRequest,
  InfaktKsefStatus,
  InfaktListResponse,
  InfaktSendToKsefResponse,
  InfaktInvoiceService,
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
 * Page size requested for the NIP client lookup (#1926).
 *
 * `q[clean_nip_eq]` is an equality match, so one page is always enough for a
 * legitimate result; the explicit limit only bounds the payload if the filter
 * ever silently stops filtering (inFakt's failure mode for an unrecognised key —
 * see `findClientByNip`). In that degraded case the client-side re-match may not
 * find a client that sits beyond this page, which costs one duplicate rather
 * than a wrong link — the safe direction, since unfiltered paging has no stable
 * sort either (the same id can repeat across pages, verified live).
 */
const CLIENT_LOOKUP_PAGE_SIZE = 25;

/**
 * Reduce a tax id to bare digits for comparison and for the NIP lookup filter.
 *
 * `q[clean_nip_eq]` normalises both sides itself, but sending the bare-digit
 * form keeps the request independent of however the buyer's tax id was
 * formatted upstream, and the same helper backs the client-side re-match, which
 * compares a stored `525-224-84-98` against a requested `PL5252248498`
 * (verified live, #1926).
 */
function normalizeNip(taxId: string): string {
  return taxId.replace(/\D/g, '');
}

/**
 * Normalises the neutral `IssueInvoiceCommand.currency` to inFakt's `currency`
 * field (#2103).
 *
 * inFakt's `currency` DEFAULTS to the account currency when the field is absent
 * or unusable, and the API answers 200/201 either way - so a dropped or
 * malformed code is not a rejected request, it is a document booked in the wrong
 * units with no error anywhere. Since inFakt relays to KSeF on the seller's
 * behalf, that wrong document then clears the tax authority, which OL cannot
 * quietly re-issue. Hence: uppercase the code, and refuse the write outright
 * rather than let anything ambiguous reach the provider.
 *
 * Status 422 (a 4xx → `failureMode: 'rejected'`) is deliberate: the throw
 * happens BEFORE the POST, so nothing crossed the provider boundary and core can
 * safely surface a terminal business failure the operator can re-submit.
 *
 * The check is a shape check (three ASCII letters), not a closed allow-list of
 * codes: inFakt owns which currencies the seller's account may settle in and
 * rejects the rest itself, so an allow-list here would only add a second, staler
 * gate. KSeF's own adapter does hold a closed list, but only because FA(3)'s
 * `KodWaluty` is an XSD enum it must satisfy before submitting.
 */
function toInfaktCurrency(currency: string | null | undefined, context: string): string {
  const normalized = (currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new InfaktApiError(
      `Infakt requires an ISO 4217 currency on ${context}, got "${currency ?? ''}" - refusing to ` +
        `issue a document that Infakt would silently book in the account's default currency`,
      422,
      { currency: currency ?? null },
    );
  }
  return normalized;
}

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
 * Poland's standard VAT rate - the "regime rate" this adapter substitutes when
 * core leaves `InvoiceLine.taxRate` empty.
 *
 * That substitution is what the whole #2245 epic exists to remove: a silent 23%
 * is indistinguishable from a confirmed 23% on the issued document, and the
 * entire cost of being wrong lands on the seller. It is removed BY THE ROLLOUT
 * SWITCH rather than by a deploy (#2257, gated in the #2245 review) - with
 * `OL_TAX_RATE_STRICT_ENABLED=true` a rate-less line is refused; with the switch
 * off (the default) the pre-epic default stands, because catalogue coverage is
 * zero on deploy and refusing here would 422 every invoice on day one.
 *
 * The two constants MUST stay consistent with each other: a net/gross split that
 * does not match the declared `tax_symbol` is itself rejected by inFakt as an
 * invalid `value.tax_values`.
 *
 * Verified live (2026-07-01): an empty `tax_symbol` does not merely get rejected
 * on its own field - inFakt cascades it into `services.gross` /
 * `value.tax_values` errors too, so EVERY line on EVERY invoice 422'd before
 * this fallback existed. That is precisely the outage the switch defers.
 */
const DEFAULT_PL_VAT_SYMBOL = '23';
const DEFAULT_PL_VAT_RATE = 0.23;

/**
 * Maps a neutral taxRate string to an Infakt `tax_symbol`.
 *
 * The neutral code is percent-as-string (#2247), so the fractional spellings
 * this switch used to accept (`'0.23'`, `'0.08'`, `'0.05'`) are gone -
 * `assertPercentTaxRateNotation` rejects them instead of quietly treating
 * `'0.23'` as 23%, which is the reading that made a genuine 1% rate resolve
 * to 100%.
 *
 * `'0'` maps to `zw`, which is a deliberate PL-regime choice rather than a
 * notation one: Infakt has no numeric zero symbol, so a zero-rated line is
 * declared exempt. That mapping is the adapter's to own (ADR-026).
 */
function toInfaktTaxSymbol(taxRate: string): string {
  const code = assertPercentTaxRateNotation(taxRate);
  switch (code) {
    case '23':
      return '23';
    case '8':
      return '8';
    case '5':
      return '5';
    case '0':
    case 'zw':
    case 'exempt':
      return 'zw';
    case 'np':
    case 'oo':
      return 'np';
    default:
      // An empty code resolves to the regime default only while strict
      // enforcement is off; under it, `assertEveryLineHasATaxRate` has already
      // refused the command before this runs.
      return code === '' ? DEFAULT_PL_VAT_SYMBOL : code;
  }
}

/**
 * Parses a tax-rate string (a neutral percent-as-string code such as `'23'`,
 * or an Infakt `tax_symbol` like `'zw'`/`'np'`) to a decimal fraction.
 *
 * Notation is settled centrally (#2247): `taxRatePercentToFraction` divides by
 * 100 and throws on fractional input. The old `n > 1` heuristic that lived here
 * accepted both spellings and, as a side effect, read a genuine 1% rate as 100%.
 *
 * Must stay consistent with `toInfaktTaxSymbol`'s empty-string fallback - a
 * mismatched net/gross split for the declared tax_symbol is itself rejected by
 * Infakt as an invalid `value.tax_values`. Under strict enforcement neither is
 * reachable: the command is refused first.
 */
function taxRateNumeric(taxRate: string): number {
  if (taxRate.trim() === '') return DEFAULT_PL_VAT_RATE;
  return taxRatePercentToFraction(taxRate) ?? 0;
}

/** Converts a buyer-paid gross unit price (PLN) to Infakt's net unit price (PLN) for the given tax rate. */
function grossToNet(unitPriceGross: number, taxRate: string): number {
  return unitPriceGross / (1 + taxRateNumeric(taxRate));
}

/**
 * Read the created document's own per-line amounts (#2251).
 *
 * Infakt reports every money field in integer groszy, so each is divided back
 * to PLN here rather than at the call site - the conversion is Infakt's wire
 * detail and belongs on this side of the boundary.
 *
 * Line numbers are 1-based positions in the response's `services` array, which
 * is the order the lines were submitted in and therefore the order the document
 * shows them. A `correction: true` row on a corrective document occupies its own
 * position exactly like any other line, so nothing shifts.
 */
function toDocumentLineAmounts(
  services: readonly InfaktInvoiceService[] | undefined,
): IssuedDocumentLineAmounts[] | undefined {
  if (!services || services.length === 0) return undefined;
  return services.map((service, index) => ({
    lineNumber: index + 1,
    unitNet: fromGroszy(service.unit_net_price ?? 0),
    net: fromGroszy(service.net_price ?? 0),
    tax: fromGroszy(service.tax_price ?? 0),
    gross: fromGroszy(service.gross_price ?? 0),
  }));
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
 * A record with neutral `documentType: 'corrected'` is an Infakt CORRECTIVE
 * invoice — a distinct resource living under `corrective_invoices/…`, NOT
 * `invoices/…` (verified live, 2026-07-03: `GET /invoices/{uuid}.json`
 * returns 404 for corrective uuids). Every read/submit path keyed on
 * `providerInvoiceId` must branch on this.
 */
function isCorrectionRecord(documentType: string): boolean {
  return documentType === 'corrected';
}

/**
 * Poll cadence for `async/corrective_invoices/status/{ref}.json` (#1763).
 * The interval mirrors the KSeF adapter's clearance-poll cadence; the cadence
 * itself was never measured under load — in every live sandbox run
 * (2026-07-28/29) the task had already resolved by the first status read, so
 * the p99 is unknown.
 *
 * Consequence of the timeout: `awaitCorrectionTask` throws 504 →
 * `failureMode: 'in-doubt'`, so a correction Infakt takes longer than this to
 * process parks the record for manual reconciliation even though it will
 * likely succeed moments later. The task reference is carried in the error
 * message so the operator can reconcile it. 30s is deliberately conservative
 * for a document-creation pipeline that also relays to KSeF — worth raising
 * once the real cadence can be measured.
 *
 * The 30s ceiling fits both call paths: the worker's stuck-job lock threshold
 * is 15 minutes (`SyncJobRunner.STUCK_JOB_TIMEOUT_MINUTES`), and the HTTP path
 * (`POST /v1/invoices/{id}/correct`) is an operator-initiated synchronous
 * request with no shorter server-side budget.
 *
 * **Interaction with per-connection rate limiting (#1810).** Every status read
 * below now goes through the connection-bound transport, whose wait counts
 * against this wall-clock deadline — so throttling eats poll attempts rather
 * than extending the budget. Two consequences worth knowing before tuning
 * either number:
 *
 * - An operator-configured `config.rateLimit.requestsPerMinute` low enough that
 *   its minimum-interval spacing exceeds ~2s starves this loop, and the
 *   limiter's own `MAX_TOTAL_WAIT_MS` (120s) is 4x this deadline — a single
 *   queued acquisition can blow the whole budget. Infakt deliberately ships no
 *   manifest default (see `infaktAdapterManifest`), so this is inert until an
 *   operator opts in; an aggressive cap here trades throughput for
 *   `in-doubt` fiscal documents, which is the wrong trade.
 * - Even with NO cap configured, a 429/503 carrying `Retry-After` now delays
 *   subsequent reads: the transport records it and the limiter honours
 *   `nextAvailableAt` unconditionally, not only when an RPM policy is set. This
 *   is the desired reactive behaviour (`InfaktHttpClient` has no retry logic of
 *   its own), but it means the deadline can be consumed by the provider's own
 *   backpressure.
 */
const CORRECTION_ASYNC_POLL_INTERVAL_MS = 2000;
const CORRECTION_ASYNC_POLL_TIMEOUT_MS = 30000;

/**
 * Maps an async task's TERMINAL `processing_code` onto the HTTP-shaped status
 * `InfaktApiError` derives `failureMode` from.
 *
 * A 4xx terminal code means the provider deterministically refused to create
 * the document — verified live (2026-07-29): an invalid payload resolves to
 * `{processing_code: 422, processing_description: "Nie udało się stworzyć
 * faktury"}` with no `invoice_uuid`. That is the `'rejected'` (safe to
 * re-attempt) class, so it must be propagated verbatim; collapsing it to 502
 * would make `failureMode: 'in-doubt'` and park the record for manual
 * reconciliation even though nothing was created.
 *
 * Anything else (an unknown or 5xx-shaped code) stays 502 → `'in-doubt'`: a
 * document MAY exist, so core must not auto-re-attempt.
 */
function terminalFailureStatus(processingCode: number): number {
  return processingCode >= 400 && processingCode < 500 ? processingCode : 502;
}

export class InfaktInvoicingAdapter
  implements
    InvoicingPort,
    RegulatoryStatusReader,
    PaymentStatusReader,
    PaymentMarker,
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
    return response.entities.map((account) => ({
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
    // Infakt uses NIP (pl-nip scheme) for B2B client dedup. Persisted in the
    // normalised bare-digit form (#1926): inFakt stores whatever it is given, so
    // writing a prefixed or separator-formatted NIP would leave the seller's own
    // records carrying three spellings of one tax id, and would depend on the
    // filter's normalisation to stay findable at all.
    const rawNip = buyer.taxId?.scheme === 'pl-nip' ? buyer.taxId.value : null;
    const nip = rawNip === null ? null : normalizeNip(rawNip) || null;

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
    // #1797: without `email`, Infakt creates the client with no email on
    // file, so a later `deliver_via_email.json` call 422s ("adres e-mail
    // Klienta jest nieznany") — confirmed live against the sandbox.
    // Typed against the WRITE shape (#2103 review) so the field-name drift that
    // caused #1926 fails type-check rather than 422-ing live. Same guard the
    // issue path got via `InfaktInvoiceRequest`.
    const payload: InfaktClientRequest = {
      client: {
        company_name: buyer.name,
        nip: nip ?? undefined,
        email: buyer.email ?? undefined,
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
    // #2257 — defence in depth, and only under the rollout switch. With strict
    // enforcement on, core refuses a rate-less command before the adapter is
    // reached, so this should be unreachable; it exists because the alternative
    // to failing is silently substituting a rate onto a real fiscal document.
    // With the switch off the regime default below stands, which is what keeps
    // a zero-coverage catalogue issuing while its rates are filled in.
    assertEveryLineHasATaxRate(cmd);
    const { lines, documentType, idempotencyKey, orderId } = cmd;
    // Resolved BEFORE the client upsert so a malformed currency costs no
    // provider round-trip and cannot leave a freshly-created client behind.
    const currency = toInfaktCurrency(cmd.currency, `invoice for order ${orderId}`);
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

    // Typed against the WRITE shape, not the response shape (#2103 review): with
    // `InfaktInvoiceRequest.currency` required, dropping the field from this
    // literal again is a type error rather than a silently mis-denominated
    // document. Mirrors the correction path's `InfaktCorrectiveInvoiceRequest`.
    const payload: InfaktInvoiceRequest = {
      invoice: {
        kind,
        // ISO 4217 settlement currency (#2103). Stamped explicitly and
        // unconditionally - omitting it makes Infakt book the document in the
        // account's default currency with no error, so a EUR order issued (and
        // KSeF-cleared) as PLN. See `toInfaktCurrency` / `InfaktInvoice.currency`.
        currency,
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
    //
    // #2251: the created invoice's own per-line amounts ARE reported. Infakt is
    // the calculator on this path, so core storing its own recomputation would
    // leave the record disagreeing with the document by a grosz here and there,
    // with no way for a reader to tell which is right.
    return { record, documentLines: toDocumentLineAmounts(invoice.services) };
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

  /**
   * `PaymentMarker.markPaid` (#1362) - the outbound counterpart to
   * `getPaymentStatus`: push an authoritative "paid" state to inFakt for an
   * order settled elsewhere (e.g. a marketplace order - the buyer paid the
   * marketplace, not the seller's bank account, so inFakt has no bank
   * statement to auto-match against). Verified live against the sandbox
   * (2026-07-08): `POST /async/invoices/{uuid}/paid.json` returns 201 with an
   * async task envelope (`processing_code: 100`, "task accepted" - not
   * "completed"), and an immediate re-read shows `status: 'paid'` /
   * `paid_date` set. Re-marking an already-paid invoice is safe (still 201,
   * no error).
   *
   * Async on inFakt's side: the caller is responsible for re-reading via
   * `getPaymentStatus` afterward if it needs OL's own projection updated -
   * this method only confirms the provider ACCEPTED the mark, not that its
   * processing has finished.
   *
   * NO currency is stamped here, deliberately (#2103). Unlike the two issue
   * paths, this write carries no monetary value at all: neutral
   * `MarkInvoicePaidCommand` is `{ externalInvoiceId, paidDate }`, and inFakt's
   * `paid.json` accepts only `paid_date` (plus an `allow_correction` flag) - it
   * settles the document in full, against the currency the document itself
   * already carries. There is therefore no amount that could be mis-denominated,
   * and adding a `currency` field here would be a second, drift-prone opinion
   * about a document inFakt already owns. The unit spec pins the payload to
   * exactly `paid_date` so a future partial-payment amount cannot be added
   * without revisiting the currency question.
   */
  async markPaid(cmd: MarkInvoicePaidCommand): Promise<void> {
    await this.http.post(`async/invoices/${encodeURIComponent(cmd.externalInvoiceId)}/paid.json`, {
      invoice: { paid_date: cmd.paidDate.toISOString().slice(0, 10) },
    });
    this.logger.log(`Infakt invoice ${cmd.externalInvoiceId} marked as paid`);
  }

  async issueCorrection(cmd: IssueCorrectionCommand): Promise<IssueInvoiceResult> {
    const { originalProviderInvoiceId, reason, lines, documentType, idempotencyKey, orderId } = cmd;

    // Fetch original to build the before/after service arrays
    const original = await this.http.get<InfaktInvoice>(
      `invoices/${encodeURIComponent(originalProviderInvoiceId)}.json`,
      { invoice_type: 'vat' },
    );

    // A correction is denominated by the document it corrects, so the currency
    // comes from the ORIGINAL as Infakt actually holds it (#2103) - not from the
    // account default (what omitting the field would fall back to) and not from
    // core, which carries no top-level currency on `IssueCorrectionCommand`. It
    // must match `original.services`, from which the before/after rows below are
    // built verbatim.
    const currency = toInfaktCurrency(
      original.currency,
      `correction of invoice ${original.number ?? originalProviderInvoiceId}`,
    );

    // `originalDocument` is OL's own issuance-time snapshot of the same document
    // (#1297). It is NOT used as the correction's currency - the provider's value
    // is authoritative and is what the corrected amounts are expressed in - but a
    // divergence means OL's fiscal projection disagrees with the provider about a
    // document it already issued, which is worth surfacing rather than swallowing.
    const snapshotCurrency = cmd.originalDocument?.currency?.trim().toUpperCase();
    if (snapshotCurrency && snapshotCurrency !== currency) {
      this.logger.warn(
        `Infakt correction of ${originalProviderInvoiceId}: OL's issuance snapshot says ` +
          `${snapshotCurrency} but Infakt holds ${currency}; correcting in ${currency} (the provider's own currency)`,
      );
    }

    // The operator's free-text reason cannot be forwarded to this provider
    // (see `correction_reason` on the payload below). Log the loss so it is
    // observable at runtime rather than only discoverable by reading this
    // adapter — an operator typing "agreed with buyer over phone" otherwise
    // has no way to learn the text never left OL (#1899 review).
    if (reason) {
      this.logger.warn(
        `Infakt correction of ${originalProviderInvoiceId}: operator reason discarded — ` +
          `Infakt's correction_reason takes a closed symbol vocabulary, not free text: "${reason}"`,
      );
    }

    // A line number outside 1..original.services.length matches no original
    // row below, so every group would emit an IDENTICAL before/after pair —
    // Infakt happily accepts that and mints a real, fiscally meaningless
    // 0.00 PLN corrective document, which then goes to KSeF (reproduced live
    // 2026-07-29: an `originalLineNumber: 99` typo produced `3/KOR/07/2026`
    // with `gross_price: 0`). A DUPLICATE line number is the same class of
    // defect from the other direction: two corrected rows would be emitted
    // for one group, so the group's before/after pairing — which is what
    // Infakt computes the correction delta from — is no longer well-defined.
    // Reject both BEFORE the POST. Status 422 (a 4xx → `failureMode:
    // 'rejected'`) is deliberate: nothing crossed the provider boundary, so
    // the operator can safely re-submit with valid lines.
    const lineCount = original.services.length;
    const requestedLines = lines.map((l) => l.originalLineNumber);
    const outOfRange = requestedLines.filter(
      (n) => !Number.isInteger(n) || n < 1 || n > lineCount,
    );
    if (outOfRange.length > 0) {
      throw new InfaktApiError(
        `Correction references line number(s) ${outOfRange.join(', ')} that do not exist on invoice ` +
          `${original.number ?? originalProviderInvoiceId} (it has ${lineCount} line(s)) — refusing to ` +
          `issue a correction that would change nothing`,
        422,
        { correctedInvoiceUuid: original.uuid, lineCount, outOfRange },
      );
    }
    const duplicated = [...new Set(requestedLines.filter((n, i) => requestedLines.indexOf(n) !== i))];
    if (duplicated.length > 0) {
      throw new InfaktApiError(
        `Correction references line number(s) ${duplicated.join(', ')} more than once on invoice ` +
          `${original.number ?? originalProviderInvoiceId} — a line can only be corrected to one value`,
        422,
        { correctedInvoiceUuid: original.uuid, duplicated },
      );
    }

    // Build correction services: original row (correction: false) + corrected
    // row (correction: true), paired per `group`.
    //
    // #1763: wire format for `unit_net_price`/`quantity` on this endpoint —
    // the previous decimal "amount currency" STRING format (e.g. "811.37 PLN")
    // was carried over from testing against the bare `corrective_invoices.json`
    // path, which turned out to 500 on EVERY payload regardless of shape (the
    // root #1763 bug — see the async-endpoint fix above). That means the prior
    // "verified live" claim behind the string format was never actually
    // confirmed against a working endpoint. On the correct
    // `async/corrective_invoices.json` path the format is the SAME plain-
    // integer-groszy / numeric-quantity shape as `async/invoices.json` (see
    // toGroszy/fromGroszy), live-verified 2026-07-29 — see
    // `InfaktCorrectiveInvoiceServiceRequest` for the round-tripped sample.
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
            quantity: svc.quantity,
            unit_net_price: toGroszy(originalNet),
            correction: false,
          },
          // Corrected "after" row
          {
            ...shared,
            quantity: corrQty,
            unit_net_price: corrPriceGroszy,
            correction: true,
          },
        ];
      });

    // Corrections go to the DEDICATED corrective_invoices.json endpoint with
    // the `corrective_invoice` wrapper key (#1337) — posting a
    // `kind: 'corrective'` payload to invoices.json makes Infakt SILENTLY
    // ignore every correction field and create a plain, unlinked VAT invoice
    // (verified live, 2026-07-03). Fiscally wrong, hence the belt-and-
    // suspenders `kind` assertion on the hydrated document in
    // `awaitCorrectionTask` too.
    //
    // #1763: creating a correction is inFakt's DOCUMENTED asynchronous
    // creation flow — `POST /api/v3/async/corrective_invoices.json`
    // (confirmed against inFakt's own published API reference, same async
    // contract as `async/invoices.json`) — not the bare `corrective_invoices.json`
    // path this adapter previously called, which 500s on every payload
    // regardless of shape (consistent with hitting an unsupported/removed
    // path rather than a genuine provider bug). See `createCorrectionAsync`.
    const payload: InfaktCorrectiveInvoiceRequest = {
      corrective_invoice: {
        // Same explicit stamp as the issue path (#2103) - the corrected
        // original's own currency, so a correction can never be booked in a
        // different currency than the document it corrects.
        currency,
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
        // Documented alongside corrected_invoice_number/_date as a third,
        // unambiguous way to identify the original document (#1763 diagnostic
        // step — the number+date pair alone still 422'd with the generic
        // "Nie udało się stworzyć faktury" on the newly-fixed async endpoint).
        corrected_invoice_uuid: original.uuid,
        // #1763: `correction_reason_symbol` is documented READ-ONLY (Infakt
        // sets it server-side) — the adapter previously sent it anyway. The
        // WRITABLE field is `correction_reason` itself: "Zapis: symbol
        // powodu; odczyt: polska nazwa" (write: reason SYMBOL; read: the
        // Polish display name) — i.e. it takes a value from Infakt's closed
        // reason-code vocabulary, not arbitrary free text, mirroring how
        // `tax_symbol` elsewhere in this API is a small fixed set rather than
        // a free string. `IssueCorrectionCommand.reason` is core's
        // intentionally free-text field (no neutral reason-code vocabulary
        // exists in core today), so it cannot be forwarded as-is; `'other'`
        // is the one documented/known-valid symbol. Losing the operator's
        // free text here is an accepted limitation until core grows a neutral
        // correction-reason-code vocabulary to map from.
        correction_reason: 'other',
        services: correctionServices,
        ...(idempotencyKey ? { external_id: idempotencyKey } : {}),
      },
    };

    // InfaktApiError carries `failureMode`; propagate as-is (see issueInvoice).
    // The silent-downgrade guard (#1337) — refusing to persist a record for
    // anything other than a real correction — lives inside
    // `awaitCorrectionTask`: the task envelope's `invoice_kind` is checked
    // first (it names the REQUESTED resource), then the created document's own
    // `kind` once hydrated (the actual outcome).
    const invoice = await this.createCorrectionAsync(payload);

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
      //
      // #2251: the CORRECTION's own line amounts. A correction is the latest
      // effective document, so these overwrite the stored figures rather than
      // leaving the record showing the pre-correction ones.
      documentLines: toDocumentLineAmounts(invoice.services),
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
   *
   * `deliver_via_email.json` replies `202 Accepted` with an empty body (it's
   * a fire-and-forget async trigger, #1797) — `postForEffect` tolerates that,
   * unlike the generic `post<T>()` used elsewhere in this adapter.
   */
  async sendByEmail(cmd: SendInvoiceByEmailCommand): Promise<SendInvoiceByEmailResult> {
    const locale = toInfaktEmailLocale(cmd.locale);
    const payload = {
      print_type: 'original',
      ...(locale ? { locale } : {}),
      ...(cmd.sendCopy !== undefined ? { send_copy: cmd.sendCopy } : {}),
    };
    await this.http.postForEffect(
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

  /**
   * Resolve an existing inFakt client by NIP (#1926).
   *
   * Two inFakt behaviours dictate the shape of this method:
   *
   * 1. **The filter must be Ransack-keyed.** A bare `?nip=` is silently
   *    IGNORED — inFakt answers `200` with the seller's whole unfiltered first
   *    page — and so is any unrecognised `q[...]` key. `q[clean_nip_eq]` is the
   *    key used here: it compares with separators and any country prefix
   *    stripped on BOTH sides, which matters because inFakt stores whatever NIP
   *    form it was given (it only validates the checksum). A client entered as
   *    `525-224-84-98` in the inFakt UI, or created by OL before #1926 from an
   *    unnormalised `buyer.taxId`, is therefore unreachable via the stricter
   *    `q[nip_eq]` on bare digits — and one missed match is one duplicate
   *    client. The NIP is still normalised before it is sent, so the request is
   *    independent of however the tax id was formatted upstream.
   * 2. **Therefore the filter is never identity proof.** Because a filter that
   *    stops working degrades into "full page, HTTP 200", every returned client's
   *    NIP is re-matched here. Without that, `entities[0]` would adopt an
   *    arbitrary client, and since the invoice payload references the buyer only
   *    by `client_id` (no inline buyer block), a wrong adoption would issue — and
   *    e-mail — a KSeF-cleared document naming the wrong company.
   *
   * Several clients may legitimately carry the same NIP (inFakt does not dedupe
   * server-side, and the #1373/#1374 regression minted one duplicate per
   * issuance for three weeks). An exact-NIP match cannot be a different legal
   * entity, so the oldest (lowest-id) match is adopted deterministically and the
   * duplicates are logged, rather than declining to match — which would keep
   * minting new duplicates for exactly the buyers already worst affected.
   *
   * No `try/catch`: inFakt answers `200` for "no match", so a negative result
   * already falls out of the re-match finding nothing. A transport or 5xx
   * failure must surface as a retryable failed issuance instead of being
   * reported as "not found" and silently turned into another duplicate client.
   */
  private async findClientByNip(nip: string): Promise<InfaktClient | null> {
    const normalized = normalizeNip(nip);
    if (normalized.length === 0) {
      return null;
    }

    const list = await this.getListResponse<InfaktClient>('clients.json', {
      'q[clean_nip_eq]': normalized,
      limit: String(CLIENT_LOOKUP_PAGE_SIZE),
    });

    const matches = list.entities
      .filter((client) => normalizeNip(client.nip ?? '') === normalized)
      .sort((a, b) => a.id - b.id);

    if (matches.length > 1) {
      this.logger.warn(
        `Infakt holds ${matches.length} clients for NIP ${normalized} (ids: ${matches
          .map((client) => client.id)
          .join(', ')}); reusing the oldest`,
      );
    }

    return matches[0] ?? null;
  }

  /**
   * Loud guard against list-envelope drift (#1373/#1374/#1926).
   *
   * Every inFakt v3 list resource answers `{ metainfo, entities }`; #1374 wrongly
   * retargeted both readers at `{ items, pagination }` — a shape no inFakt
   * version, header, or content-negotiation path emits — which made
   * `listBankAccounts` a permanent 502 and turned `findClientByNip` into an
   * always-create branch. The guard itself was the right instinct (a bare
   * `undefined.map()` `TypeError` is indistinguishable, once the controller masks
   * it into a generic 502, from an unreachable provider), so it stays, pointed at
   * the real key: a genuine future drift throws a named, path-specific
   * `InfaktApiError` whose message `toProviderBadGateway` logs. Deliberately NOT
   * tolerant of both shapes — accepting the fabricated one would enshrine it and
   * hide the next real drift.
   */
  private async getListResponse<T>(
    path: string,
    query?: Record<string, string>,
  ): Promise<InfaktListResponse<T>> {
    const response = await this.http.get<InfaktListResponse<T>>(path, query);
    if (!response || !Array.isArray(response.entities)) {
      throw new InfaktApiError(
        `Infakt ${path} returned an unexpected envelope shape (expected { entities: [...] })`,
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

  /**
   * Posts to inFakt's documented async correction endpoint (#1763), polls
   * `async/corrective_invoices/status/{ref}.json` until the task leaves
   * `processing_code: 100` ("still processing"), then hydrates the full
   * invoice via `GET corrective_invoices/{uuid}.json` — the task envelope
   * itself never carries the full invoice fields (number, client_id, …).
   *
   * Terminal-success shape confirmed live (2026-07-28) against the sandbox:
   * `processing_code: 201`, `processing_description: "Faktura stworzona"`,
   * `action: "create_invoice"`, `invoice_kind: "corrective_invoice"`,
   * `invoice_uuid: "<uuid>"`. An earlier version of this method checked for a
   * `uuid` field directly on the task response (there is none — the field is
   * `invoice_uuid`) and treated every non-100 code as failure, which
   * misclassified this exact success as an error.
   */
  private async createCorrectionAsync(
    payload: InfaktCorrectiveInvoiceRequest,
  ): Promise<InfaktInvoice> {
    const accepted = await this.http.post<InfaktAsyncTaskAccepted>(
      'async/corrective_invoices.json',
      payload,
    );
    return this.awaitCorrectionTask(accepted);
  }

  private async awaitCorrectionTask(initial: InfaktAsyncTaskAccepted): Promise<InfaktInvoice> {
    const taskRef = initial.invoice_task_reference_number;
    const deadline = Date.now() + CORRECTION_ASYNC_POLL_TIMEOUT_MS;
    let last = initial;
    while (last.processing_code === 100) {
      if (Date.now() >= deadline) {
        throw new InfaktApiError(
          `Infakt async correction task ${taskRef} did not resolve within ${CORRECTION_ASYNC_POLL_TIMEOUT_MS}ms`,
          504,
          last,
        );
      }
      await this.sleep(CORRECTION_ASYNC_POLL_INTERVAL_MS);
      last = await this.http.get<InfaktAsyncTaskAccepted>(
        `async/corrective_invoices/status/${encodeURIComponent(taskRef)}.json`,
      );
    }

    // Belt-and-suspenders (#1337 precedent): `invoice_uuid` is the ONLY field
    // that discriminates success — `invoice_kind: 'corrective_invoice'` is
    // echoed on the accepted (`processing_code: 100`) AND the failure
    // (`processing_code: 422`) envelope alike (verified live 2026-07-29), so
    // it identifies the REQUESTED kind, not the outcome. It is still asserted
    // so a task envelope for some other resource can never be hydrated as a
    // correction.
    if (!last.invoice_uuid || last.invoice_kind !== 'corrective_invoice') {
      throw new InfaktApiError(
        `Infakt async correction task ${taskRef} did not resolve to a corrective_invoice (processing_code ${last.processing_code}): ${last.processing_description}`,
        terminalFailureStatus(last.processing_code),
        last,
      );
    }

    const invoice = await this.http.get<InfaktInvoice>(
      `corrective_invoices/${encodeURIComponent(last.invoice_uuid)}.json`,
    );

    // The real #1337 guard: assert the kind of the document that was ACTUALLY
    // created, not the kind the task envelope says was requested. Posting a
    // correction payload to the wrong resource makes Infakt silently ignore
    // every correction field and mint a plain, unlinked VAT invoice (verified
    // live, 2026-07-03) — fiscally wrong, and only visible on the hydrated
    // document. Kept at 502 → `failureMode: 'in-doubt'` (not `'rejected'`):
    // a document DOES exist at the provider, so core must not auto-re-attempt
    // and mint a second one.
    if (invoice.kind !== 'correction') {
      throw new InfaktApiError(
        `Infakt async correction task ${taskRef} created a '${invoice.kind}' document (${invoice.uuid}) instead of a correction — refusing to persist it as one`,
        502,
        invoice,
      );
    }

    return invoice;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Refuse a command whose lines do not all name a tax rate (#2257), when the
 * deployment has switched strict enforcement on.
 *
 * Under strict enforcement a rate-less line has nowhere to resolve to. Raising
 * the same neutral exception core does keeps the failure legible at every layer
 * - and keeps its existing 422 mapping - rather than surfacing as an inFakt
 * wire-field rejection nobody can act on. A pre-rollout order is exempt at both
 * ends: core's own guard passes it through, and `isTaxRateEnforced` reads the
 * command's own era here too, so the documented default is what serves it. The
 * two must agree - a guard that read only the switch would refuse on this route
 * what the other routes issue.
 */
function assertEveryLineHasATaxRate(cmd: IssueInvoiceCommand): void {
  if (!isTaxRateEnforced(cmd.taxRateEra)) return;
  const finding = findMissingTaxRate(
    cmd.lines.map((line) => ({ productId: line.name, taxRate: line.taxRate })),
  );
  if (finding) throw new MissingTaxRateException(cmd.orderId, finding);
}
