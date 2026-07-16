/**
 * Invoicing Domain Types
 *
 * Country/regulatory-agnostic vocabulary for the invoicing bounded context
 * (ADR-026). Names are drawn from international standards — never a country's
 * tax system: scheme-tagged tax identifiers (EN 16931 BT-30 / ISO 6523),
 * open-world document types (UNTDID 1001 functional types + `receipt`), a
 * neutral CTC clearance lifecycle, and ISO-4217 currency on the command.
 * Litmus test: no `nip`/`ksef`/`vat`/`jpk`/`faktura` appears here — those live
 * behind the provider adapter.
 *
 * @module libs/core/src/invoicing/domain/types
 */
import type { BuyerProfile } from '../entities/buyer-profile.entity';
import type { InvoiceRecord } from '../entities/invoice-record.entity';

/**
 * Document type — OPEN-WORLD (regimes vary unbounded). Well-known neutral
 * values align to UNTDID 1001 functional types, plus `receipt` (the simplified
 * B2C document the international standard deliberately omits but PL/EU regimes
 * need). Adapters may issue additional neutral types; the boundary accepts any
 * string (mirrors the `CoreCapability` open-world idiom, #576).
 */
export const DocumentTypeValues = [
  'invoice',
  'receipt',
  'credit-note',
  'corrected',
  'proforma',
  'prepayment',
] as const;
export type DocumentType = (typeof DocumentTypeValues)[number];

/**
 * Issuance lifecycle of an `InvoiceRecord` (distinct from payment — see ADR-026).
 *
 * `issuing` (#1200) is the in-flight CLAIM state: a record an attempt has leased
 * to cross the provider boundary. It sits between `pending` (intent persisted,
 * not yet claimed) and the terminal `issued`/`failed`. A concurrent same-key
 * retry that finds a record under a LIVE `issuing` lease must NOT re-cross the
 * boundary — exactly one attempt may hold the slot (closes R2 + the `pending`
 * half of R3). The lease has an expiry (`leaseExpiresAt`) so a crash mid-call
 * does not orphan the record forever.
 */
export const InvoiceStatusValues = ['pending', 'issuing', 'issued', 'failed'] as const;
export type InvoiceStatus = (typeof InvoiceStatusValues)[number];

/**
 * Neutral failure discriminator (#1200) — the fiscal-safety pivot for re-attempt.
 * Carried from the provider adapter into the neutral outcome WITHOUT core ever
 * value-importing an adapter error subclass: the service reads it STRUCTURALLY
 * off the caught throwable (see `InvoiceService.classifyFailure`).
 *
 *   - `rejected`: a TERMINAL provider rejection — the provider DEFINITELY did not
 *     create a document (e.g. invalid tax data). A `failed` row of this kind is
 *     SAFE to re-attempt: re-crossing the boundary cannot double-issue.
 *   - `in-doubt`: a transient/indeterminate transport failure — the request MAY
 *     have reached the provider and a document MAY have been created (timeout,
 *     reset, unknown error). A `failed` row of this kind is UNSAFE to re-attempt:
 *     it is surfaced for manual reconciliation, never auto-re-issued. This is the
 *     FISCAL-SAFE DEFAULT: any failure whose mode the service cannot read
 *     structurally is treated as `in-doubt`.
 */
export const InvoiceFailureModeValues = ['rejected', 'in-doubt'] as const;
export type InvoiceFailureMode = (typeof InvoiceFailureModeValues)[number];

/**
 * Closed neutral failure-code taxonomy (#1214 / W1) — the machine-readable
 * companion to {@link InvoiceFailureMode}. The FE distinguishes failure causes
 * off this code without parsing the free-text (PII-tainted) `errorMessage`,
 * which is never exposed to API callers. PII-free by construction — the values
 * are fixed neutral discriminators, never an echo of provider/buyer data. Closed
 * (not open-world) because every value must map onto a deliberate FE affordance.
 *
 *   - `buyer-tax-id-invalid`: a TERMINAL `rejected` failure caused by an invalid
 *     buyer tax identifier — the operator can fix the buyer data and re-issue.
 *   - `provider-rejected`: any other TERMINAL `rejected` failure (safe to
 *     re-attempt once the underlying input is corrected).
 *   - `transport-timeout`: an `in-doubt` transport failure — the document MAY
 *     exist; NEVER auto-re-attempted, surfaced for manual reconciliation.
 *   - `provider-error`: an unclassifiable failure (the fiscal-safe default code,
 *     paired with the `in-doubt` mode).
 */
export const InvoiceFailureCodeValues = [
  'buyer-tax-id-invalid',
  'provider-rejected',
  'transport-timeout',
  'provider-error',
] as const;
export type InvoiceFailureCode = (typeof InvoiceFailureCodeValues)[number];

/**
 * Neutral Continuous-Transaction-Controls clearance lifecycle. The adapter maps
 * a regime's native states (KSeF, IT SDI, ES SII…) onto these. `not-applicable`
 * is the default for providers without regulatory transmission.
 */
export const RegulatoryStatusValues = [
  'not-applicable',
  'submitted',
  'cleared',
  'accepted',
  'rejected',
] as const;
export type RegulatoryStatus = (typeof RegulatoryStatusValues)[number];

/**
 * Outcome of a regulatory clearance submit/read (#1143). Returned by both
 * `RegulatoryTransmitter.submitForClearance` and `RegulatoryStatusReader.
 * getClearanceStatus`, so it is named `…Result` (not `…Snapshot`, which would
 * mislead as read-only). Maps 1:1 onto `InvoiceOutcomePatch`
 * (`regulatoryStatus` + `clearanceReference`) so the future service/job persists
 * it via `updateOutcome` with no translation. A business verdict (incl.
 * `rejected`) is carried here as data; a transport/infra failure throws.
 */
export interface RegulatoryClearanceResult {
  /** Neutral CTC clearance lifecycle the adapter mapped the regime's state onto. */
  regulatoryStatus: RegulatoryStatus;
  /**
   * Authority-assigned reference (KSeF number, SDI id, …) when present — typically
   * knowable only after the authority clears the document, so a read can surface
   * a reference a prior submit could not. `null`/absent until assigned.
   */
  clearanceReference?: string | null;
}

/**
 * Terminal regulatory statuses — once a record reaches one of these the
 * reconciliation job (#1121) stops polling it. `not-applicable` (receipts not
 * sent to a CTC authority) is terminal-from-birth and never polled. Single
 * source of truth for the non-terminal selection predicate; mirrored in the
 * repository query and the `IDX_invoice_records_reconcile` partial index.
 */
export const TerminalRegulatoryStatusValues = [
  'accepted',
  'rejected',
  'not-applicable',
] as const;
export type TerminalRegulatoryStatus = (typeof TerminalRegulatoryStatusValues)[number];

/** True when `status` is a terminal regulatory status (no longer polled). */
export function isTerminalRegulatoryStatus(status: RegulatoryStatus): boolean {
  return (TerminalRegulatoryStatusValues as readonly string[]).includes(status);
}

/**
 * Neutral PAYMENT lifecycle of an issued document (#1354, ADR-026) — orthogonal
 * to both the issuance `status` and the regulatory clearance `RegulatoryStatus`.
 * A provider adapter maps its native payment state onto these; `unknown` is the
 * default until OL has read an authoritative payment state (a document whose
 * provider payment state OL has never read stays `unknown`). Country/
 * provider-agnostic: no `paid_date`/`left_to_pay`/`faktura` vocabulary — those
 * live behind the adapter.
 *
 *   - `unknown`: OL has not (yet) read a payment state for this document.
 *   - `unpaid`: the provider reports nothing paid.
 *   - `partially-paid`: some but not all of the amount is settled.
 *   - `paid`: the provider reports the document fully settled.
 */
export const PaymentStatusValues = ['unknown', 'unpaid', 'partially-paid', 'paid'] as const;
export type PaymentStatus = (typeof PaymentStatusValues)[number];

/**
 * Outcome of an authoritative payment-status read (#1354). Returned by the
 * `PaymentStatusReader` sub-capability so the core refresh service persists it
 * via `updateOutcome` without translation (maps onto `InvoiceOutcomePatch.
 * paymentStatus`). A payment verdict is carried as data; a transport/infra
 * failure throws for the caller to handle.
 */
export interface PaymentStatusResult {
  /** Neutral payment lifecycle the adapter mapped the provider's state onto. */
  paymentStatus: PaymentStatus;
}

/**
 * Command to push an authoritative "paid" state to the provider for an
 * already-issued document (#1362) - the OUTBOUND counterpart to
 * `PaymentStatusReader`. `externalInvoiceId` is always the provider-native id
 * read from a previously-issued `InvoiceRecord.providerInvoiceId` - never
 * client-supplied directly. Country/provider-agnostic: no `paid_date`
 * vocabulary here - the adapter formats `paidDate` in whatever wire shape its
 * provider expects.
 */
export interface MarkInvoicePaidCommand {
  externalInvoiceId: string;
  paidDate: Date;
}

/** Neutral B2B/B2C axis. Drives document-type policy in a future rules layer, not here. */
export const BuyerTypeValues = ['company', 'private'] as const;
export type BuyerType = (typeof BuyerTypeValues)[number];

/**
 * Scheme-tagged tax identifier — EN 16931 BT-30 / ISO 6523 / Stripe `tax_ids`
 * shape. `scheme` is an OPEN string the adapter interprets (`pl-nip`, `eu-vat`,
 * `de-ustid`); core never names a country's identifier system.
 */
export interface TaxIdentifier {
  scheme: string;
  value: string;
}

/** Postal address on a buyer profile. `countryIso2` is ISO 3166-1 alpha-2. */
export interface BuyerAddress {
  line1: string;
  line2: string | null;
  city: string;
  postalCode: string;
  countryIso2: string;
}

/**
 * One invoice line. `unitPriceGross` is numeric (matches core's `number` money
 * idiom); `taxRate` is a neutral string code the provider resolves to its
 * regime (a PL adapter maps `zw`/`np` onto UNCL 5305 `E`/`O`).
 */
export interface InvoiceLine {
  name: string;
  quantity: number;
  unitPriceGross: number;
  taxRate: string;
  /**
   * Unit of measure for the quantity (free text, e.g. a piece/kg/hour label in
   * the seller's language). Country-agnostic (#1525): a neutral commercial
   * concept, not a regime code. Optional - marketplace orders carry no unit,
   * so the order mapper never sets it; the field is the seam for future
   * sources that do. Providers without a unit concept ignore it.
   */
  unit?: string;
}

/**
 * Structural buyer shape persisted inside {@link IssuedLineSnapshot}. Field-for-
 * field the data shape of {@link BuyerProfile} (a live instance assigns to it
 * directly), but typed structurally because the snapshot round-trips through
 * jsonb, which strips the class prototype (the `isCompany` getter). Consumers
 * that need a real `BuyerProfile` re-wrap it from these fields.
 */
export interface IssuedSnapshotBuyer {
  name: string;
  /** Scheme-tagged tax id; `null` when the buyer has none (typically B2C). */
  taxId: TaxIdentifier | null;
  address: BuyerAddress;
  type: BuyerType;
}

/**
 * Issuance-time snapshot of the exact command inputs a correction needs to
 * reconstruct the original document (#1297). Persisted on `InvoiceRecord` when a
 * document is issued so a later correction diffs its `originalLineNumber`-indexed
 * deltas against the lines AS ISSUED, not the order's current (possibly-edited)
 * state. Neutral (ADR-026): reuses the {@link BuyerProfile} data shape
 * ({@link IssuedSnapshotBuyer}) + {@link InvoiceLine}; no regime/provider
 * vocabulary.
 *
 * Only `buyer`/`currency`/`lines` live here — the corrected document's
 * `documentType`/clearance reference/number/issue date are read from the
 * `InvoiceRecord` itself when assembling an {@link OriginalDocumentSnapshot}.
 */
export interface IssuedLineSnapshot {
  /** Buyer as issued — structural (jsonb round-trip), see {@link IssuedSnapshotBuyer}. */
  buyer: IssuedSnapshotBuyer;
  /** ISO 4217 currency code, echoed from the issue command. */
  currency: string;
  /** Lines exactly as issued (name/quantity/unitPriceGross/taxRate/unit). */
  lines: InvoiceLine[];
}

/**
 * Neutral correction descriptor — present only when {@link IssueInvoiceCommand}
 * issues a correcting document (`documentType` of `corrected` / `credit-note`).
 *
 * Country-agnostic (ADR-026): it references the original document by its neutral
 * authority-assigned `originalClearanceReference` (the same opaque
 * `clearanceReference` vocabulary the {@link RegulatoryStatus} lifecycle uses —
 * `null` when the original was never cleared by an authority) plus the human
 * `originalDocumentNumber` + `originalIssueDate`, and carries a free-text
 * `reason`. No regime tax vocabulary appears here; the adapter maps these neutral
 * fields onto its wire shape. The command's top-level `lines` carry the *original*
 * ("before") line state; `correctedLines` carry the *post-correction* ("after")
 * state — the adapter emits whichever before/after representation its regime needs.
 */
export interface CorrectionReference {
  /** Authority-assigned reference of the original document; `null` if never cleared. */
  originalClearanceReference: string | null;
  /** Human-facing sequential number of the corrected original document. */
  originalDocumentNumber: string;
  /** Issue date of the corrected original, ISO 8601 calendar `YYYY-MM-DD`. */
  originalIssueDate: string;
  /** Free-text reason for the correction (return, refund, price adjustment, …). */
  reason: string;
  /** Post-correction ("after") line state; the top-level `lines` carry the original. */
  correctedLines: InvoiceLine[];
}

/**
 * Seller party captured on an issued-document snapshot. Country-agnostic: the
 * tax identity is a scheme-tagged {@link TaxIdentifier} (the adapter resolves it
 * from its own connection config, e.g. a PL adapter emits `{ scheme: 'pl-nip' }`)
 * — never a bare NIP. Mirrors {@link BuyerProfile}'s neutral shape minus the
 * B2B/B2C `type` axis (a seller is always the issuing party).
 */
export interface IssuedDocumentSeller {
  name: string;
  taxId: TaxIdentifier;
  address: BuyerAddress;
}

/**
 * Buyer party as captured on an issued-document snapshot. `taxId` is `null` for a
 * B2C buyer with no tax identity. The address reuses the neutral {@link BuyerAddress}.
 */
export interface IssuedDocumentBuyer {
  name: string;
  taxId: TaxIdentifier | null;
  address: BuyerAddress;
}

/**
 * One issued-document line snapshot. `unitNet`/`net`/`vat`/`gross` are the
 * computed money values (core's `number` idiom); `taxRate` is the neutral string
 * code echoed from the command (the provider resolves it to its regime).
 */
export interface IssuedDocumentLine {
  name: string;
  quantity: number;
  unitNet: number;
  taxRate: string;
  net: number;
  tax: number;
  gross: number;
}

/** One tax-breakdown bucket, grouped by neutral `rate` code. */
export interface TaxBreakdownEntry {
  rate: string;
  net: number;
  tax: number;
  gross: number;
}

/** Document money totals (sum across all lines). */
export interface DocumentTotals {
  net: number;
  tax: number;
  gross: number;
}

/** Neutral payment descriptor on an issued document; `null` fields when unknown. */
export interface IssuedDocumentPayment {
  method: string | null;
  paidAt: string | null;
}

/**
 * Neutral snapshot of an issued document's CONTENT, taken at issue time (ADR-026).
 * It is a non-authoritative projection backing the FE "Invoice contents" card —
 * the provider owns the authoritative document. No country/regulatory vocabulary
 * appears here: `seller`/`buyer` carry scheme-tagged tax ids, `lines`/`taxBreakdown`
 * use the neutral `taxRate` string codes, `currency` is ISO 4217, dates are ISO 8601.
 * `seller` is `null` when the issuing adapter does not surface a seller block (it
 * degrades gracefully rather than blocking the snapshot).
 */
export interface IssuedDocumentContent {
  seller: IssuedDocumentSeller | null;
  buyer: IssuedDocumentBuyer;
  lines: IssuedDocumentLine[];
  taxBreakdown: TaxBreakdownEntry[];
  totals: DocumentTotals;
  /** ISO 4217 currency code. */
  currency: string;
  /** ISO 8601 issue date; `null` when not yet known. */
  issueDate: string | null;
  /** ISO 8601 sale date; `null` when not provided. */
  saleDate: string | null;
  /** Payment descriptor; `null` when unknown. */
  payment: IssuedDocumentPayment | null;
}

/**
 * Neutral document kind a {@link RegulatoryDocumentReader} can fetch for a record.
 * Country-agnostic (ADR-026):
 *  - `confirmation` — the tax authority's confirmation/receipt document (PL: UPO).
 *  - `source` — the machine-readable source document submitted to the authority
 *    (PL: the FA(3) XML), persisted at issue time.
 *  - `rendered` — a human-readable rendering (HTML/PDF) of the source document,
 *    when the provider can produce one server-side.
 */
export const RegulatoryDocumentKindValues = ['confirmation', 'source', 'rendered'] as const;
export type RegulatoryDocumentKind = (typeof RegulatoryDocumentKindValues)[number];

/**
 * Neutral persisted document blob — provider-reported MIME type + base64-encoded
 * bytes. Used to snapshot a document (e.g. the issued source XML) at issue time so
 * it can be re-served later without a provider round-trip. jsonb-friendly (no raw
 * `Uint8Array`); the interface layer decodes the base64 to bytes when streaming.
 */
export interface StoredDocument {
  contentType: string;
  /** Base64-encoded document bytes. */
  contentBase64: string;
}

/**
 * Command to issue a fiscal document. A pure description of *what* to issue;
 * the port does not decide whether/when/which-type — a future rules layer
 * composes this (ADR-026). `currency` is ISO 4217 (single-currency invoice).
 * `documentType` is caller-supplied (open-world); the adapter may derive it
 * when absent. `idempotencyKey` backs exactly-once issuance. `correction` is
 * present only for a correcting document (see {@link CorrectionReference}); the
 * caller (the returns/refund trigger) decides *when* — the port never does.
 */
export interface IssueInvoiceCommand {
  connectionId: string;
  orderId: string;
  buyer: BuyerProfile;
  currency: string;
  lines: InvoiceLine[];
  /** Neutral document type; well-known values in {@link DocumentTypeValues} (open-world). */
  documentType?: string;
  /**
   * Date of supply / sale, ISO 8601 calendar `YYYY-MM-DD` (#1525). Filled from
   * the order's marketplace placement timestamp (`Order.placedAt`) - NEVER from
   * OL's ingestion clock (`Order.createdAt`). Absent when the source order does
   * not carry a placement date; adapters omit the corresponding wire field.
   */
  saleDate?: string;
  /**
   * Single issuance instant (#1692). Set by the core `InvoiceService` so BOTH
   * the allocated document number's date variables/period AND the provider's
   * legal issue date resolve from ONE instant (no day/period-boundary
   * divergence). A `DocumentNumberConsumer` adapter (KSeF) stamps its legal
   * issue date from this value; absent (e.g. a direct adapter call in a test)
   * the adapter falls back to its own clock.
   */
  issuedAt?: Date;
  /** Correction linkage + reason; present only for a correcting document. */
  correction?: CorrectionReference;
  idempotencyKey?: string;
  /**
   * Optional neutral register / entity-scope label (#10). Routes numbering to
   * the connection's series for `(documentType, register)`; when absent the
   * register-less default series for the document type is used. Ignored by
   * providers that number documents themselves.
   */
  register?: string;
  /**
   * OpenLinker-allocated legal document number (#1575). Set by the core
   * `InvoiceService` ONLY when the resolved adapter passes
   * `isDocumentNumberConsumer` (today: KSeF) — the adapter then uses it for its
   * legal number (KSeF FA(3) `P_2`) and echoes it as
   * `InvoiceRecord.providerInvoiceNumber` (single source, #1338). Absent for a
   * provider that numbers documents itself (inFakt/Subiekt).
   */
  documentNumber?: string;
}

/**
 * One corrected line on a correction document. Identifies the original line by its
 * position (`originalLineNumber`, 1-based) and carries the new values to apply.
 * At least one of `newQuantity` / `newUnitPriceGross` must be present — a line that
 * changes neither would be a no-op. `newUnitPriceGross` is the gross unit price
 * (matches core's `number` money idiom and `InvoiceLine.unitPriceGross`).
 */
export interface CorrectionLine {
  originalLineNumber: number;
  newQuantity?: number;
  newUnitPriceGross?: number;
}

/**
 * Best-effort reconstruction of the original document's issuance inputs,
 * assembled by the CALLER (never by adapters). Needed by adapters that must
 * resubmit a COMPLETE corrected document rather than apply a delta (e.g. KSeF's
 * FA(3) KOR, which has no delta-only correction primitive) — adapters that only
 * need per-line deltas (Subiekt) never read this field.
 *
 * PRIMARY source (#1297): the caller reads the persisted issuance-time
 * {@link IssuedLineSnapshot} off the document being corrected (`InvoiceRecord`),
 * so `buyer` (including its true tax id) and `lines` reflect the document AS
 * ISSUED — the `originalLineNumber`-indexed correction deltas then diff against
 * the correct baseline even if the order's items changed since issuance. For a
 * correction-of-correction the "document being corrected" is the prior
 * correction, whose own post-correction snapshot is the correct baseline.
 *
 * FALLBACK (records issued before the snapshot column existed): the caller
 * rebuilds from the order's CURRENT state, mirroring a keyless re-issue. Two
 * accepted limitations apply to that path ONLY:
 * - `buyer` tax id is not recoverable from the order, so it is rebuilt as
 *   `buyerTaxId: null` — same accepted limitation as a keyless re-issue.
 * - `lines` reflect the order's current state; if the order's items were
 *   modified after issuance, the deltas applied against them may not match what
 *   the provider holds for the original document. Unavoidable for pre-#1297
 *   rows with no snapshot; newly-issued documents always carry one.
 */
export interface OriginalDocumentSnapshot {
  buyer: BuyerProfile;
  /** ISO 4217 currency code, echoed from the original issue command. */
  currency: string;
  /**
   * Neutral document type of the original document (open-world). Not
   * currently read by any shipping `CorrectionIssuer` adapter (KSeF derives
   * the corrected document's type from `IssueCorrectionCommand.documentType`
   * instead) — carried for a future adapter that needs it.
   */
  documentType: string;
  /** Reconstructed "before" lines of the original document — see the accepted-limitations note above. */
  lines: InvoiceLine[];
  /** Authority-assigned reference of the original document; `null` if never cleared. */
  clearanceReference: string | null;
  /** Human-facing sequential number of the original document. */
  documentNumber: string;
  /** Issue date of the original, ISO 8601 calendar `YYYY-MM-DD`. */
  issueDate: string;
}

/**
 * Command to issue a correction of an already-issued document (ADR-026). Like
 * {@link IssueInvoiceCommand} it is a pure description of *what* to correct; the
 * port does not decide whether/when. `originalProviderInvoiceId` references the
 * provider's id of the corrected original (the adapter interprets it). `lines`
 * carry the post-correction values per original line; `reason` is the free-text
 * correction reason. `documentType` is caller-supplied (open-world); the adapter
 * defaults it when absent. `idempotencyKey` backs exactly-once issuance.
 * `originalDocument` is caller-assembled — see {@link OriginalDocumentSnapshot}.
 */
export interface IssueCorrectionCommand {
  connectionId: string;
  orderId: string;
  originalProviderInvoiceId: string;
  /** Neutral document type; well-known values in {@link DocumentTypeValues} (open-world). */
  documentType?: string;
  reason?: string;
  lines: CorrectionLine[];
  /**
   * Single issuance instant for the correction document (#1692). Set by the core
   * `InvoiceService` so the correction's allocated number and the provider's
   * legal issue date resolve from ONE instant. See {@link IssueInvoiceCommand.issuedAt}.
   */
  issuedAt?: Date;
  idempotencyKey?: string;
  /**
   * Optional neutral register / entity-scope label (#10). Routes the correction's
   * numbering to the connection's series for `(documentType, register)`; when
   * absent the register-less default correction series is used.
   */
  register?: string;
  /** Caller-assembled full original-document snapshot; see {@link OriginalDocumentSnapshot}. */
  originalDocument?: OriginalDocumentSnapshot;
  /**
   * OpenLinker-allocated legal document number for the CORRECTION document
   * (#1575). Set by the core `InvoiceService` from the connection's correction
   * series ONLY when the resolved adapter passes `isDocumentNumberConsumer`. The
   * adapter uses it for the corrected document's own legal number (KSeF FA(3)
   * `P_2` on the KOR) — corrections draw from their own series, never reusing the
   * original's number. Absent for a self-numbering provider.
   */
  documentNumber?: string;
}

/**
 * Result of {@link InvoicingPort.issueInvoice}. Wraps the neutral persisted
 * projection (`record`) and an OPTIONAL `seller` block the adapter resolved from
 * its own connection config (country-agnostic — the adapter maps its provider
 * seller identity onto the neutral {@link IssuedDocumentSeller}). Adapters that do
 * not surface a seller (e.g. a bridge that owns the document) omit it; the core
 * content snapshot then persists `seller: null` and the content endpoint degrades
 * gracefully.
 */
export interface IssueInvoiceResult {
  record: InvoiceRecord;
  seller?: IssuedDocumentSeller;
  /**
   * OPTIONAL machine-readable source document the adapter built and submitted to
   * the authority (PL/KSeF: the FA(3) XML). Core persists it as an opaque
   * {@link StoredDocument} at issue time so `GET .../document?kind=source` can
   * re-serve it without a provider round-trip. Adapters that do not expose a
   * source document omit it.
   */
  sourceDocument?: StoredDocument;
}

/** Query for an issued document by either internal order id or provider id. */
export type GetInvoiceQuery = { orderId: string } | { providerInvoiceId: string };

/**
 * Connection-scoped query for OL's OWN `InvoiceRecord` projection (distinct from
 * the provider-facing {@link GetInvoiceQuery}). The projection is keyed
 * `(orderId, connectionId)` — the shape `InvoiceRecordRepositoryPort.findByOrderId`
 * reads — so `IInvoiceService.getInvoice` answers from OL's store, never the adapter.
 */
export interface GetInvoiceByOrderQuery {
  orderId: string;
  connectionId: string;
}

/** Command to create-or-update the buyer as a customer in the provider. */
export interface UpsertCustomerCommand {
  connectionId: string;
  buyer: BuyerProfile;
}

/** Result of {@link UpsertCustomerCommand} — the provider's customer id. */
export interface UpsertCustomerResult {
  providerCustomerId: string;
}

/** Persistence input for a new `InvoiceRecord` row (pre-issue `pending` state). */
export interface CreateInvoiceRecordInput {
  connectionId: string;
  orderId: string;
  providerType: string;
  /** Neutral document type; well-known values in {@link DocumentTypeValues} (open-world). */
  documentType: string;
  status: InvoiceStatus;
  idempotencyKey: string | null;
  providerInvoiceId?: string | null;
  providerInvoiceNumber?: string | null;
  regulatoryStatus?: RegulatoryStatus;
  clearanceReference?: string | null;
  /** Neutral payment lifecycle (#1354); defaults `unknown` when omitted. */
  paymentStatus?: PaymentStatus;
  pdfUrl?: string | null;
  issuedAt?: Date | null;
  errorMessage?: string | null;
  /** Neutral failure discriminator (#1200); `null` for a non-`failed` create. */
  failureMode?: InvoiceFailureMode | null;
  /** Neutral machine-readable failure code (W1); `null` for a non-`failed` create. */
  failureCode?: InvoiceFailureCode | null;
  /** Short, PII-free failure summary (W1); `null` for a non-`failed` create. */
  failureReason?: string | null;
  /**
   * Whether the buyer carried a tax identifier at issue time (#1202). Neutral
   * presence flag set on the write path; defaults `false` when omitted.
   */
  hasBuyerTaxId?: boolean;
  /** Neutral issued-document content snapshot (§7.3); `null` when not captured. */
  documentContent?: IssuedDocumentContent | null;
  /** Persisted machine-readable source document (e.g. FA(3) XML); `null` when not captured. */
  sourceDocument?: StoredDocument | null;
  /** Issuance-time line snapshot (#1297); `null` when not captured. */
  issuedLineSnapshot?: IssuedLineSnapshot | null;
}

/**
 * Read-only filter set for {@link InvoiceRecordRepositoryPort.findMany} (#1119).
 * Minimal — backs ONLY the AC-6 list filters that map to a real column. The
 * POST re-issue gate does NOT widen this surface: it reads the order's single
 * projection row via the existing `findByOrderId(orderId, connectionId)`
 * primitive (surfaced as `IInvoiceService.getInvoice`), so `findMany` stays a
 * pure AC-6 list query. The `taxId` filter (#1202) is served by the neutral
 * denormalized `hasBuyerTaxId` column on the projection (set on the write path),
 * NOT by joining to the Order: `'with'` → `hasBuyerTaxId = true`, `'without'` →
 * `false`.
 */
export interface InvoiceRecordFilters {
  status?: InvoiceStatus;
  connectionId?: string;
  regulatoryStatus?: RegulatoryStatus;
  /** Inclusive lower bound on `issuedAt`. */
  issuedFrom?: Date;
  /** Inclusive upper bound on `issuedAt`. */
  issuedTo?: Date;
  /**
   * Filter by buyer-tax-id presence (#1202): `'with'` keeps rows where the buyer
   * carried a tax id, `'without'` keeps rows where it did not. Neutral presence
   * concept (not "nip"); maps to the denormalized `hasBuyerTaxId` column.
   */
  taxId?: 'with' | 'without';
}

/** Pagination window for {@link InvoiceRecordRepositoryPort.findMany}. */
export interface InvoiceRecordPagination {
  limit: number;
  offset: number;
}

/** Page of `InvoiceRecord`s plus the unpaginated match count. */
export interface PaginatedInvoiceRecords {
  items: InvoiceRecord[];
  total: number;
}

/**
 * Patch applied to an existing record after an issue / transmission attempt.
 * `sourceDocument` is write-once: the service sets it ONCE on the first successful
 * `issued` patch (from the adapter's {@link IssueInvoiceResult}); the repository
 * enforces at the persistence boundary that it is never overwritten once a snapshot
 * is present.
 */
export interface InvoiceOutcomePatch {
  status?: InvoiceStatus;
  /**
   * Authoritative provider identifier resolved at issue time (e.g. `subiekt`).
   * The pending row is created with `providerType: ''` (the connection's
   * declared provider is not yet known to the SVC); on a successful issue the
   * service backfills this from the adapter result so the projection no longer
   * misreports provider identity.
   */
  providerType?: string;
  /**
   * Authoritative document type. The pending row echoes the caller-supplied
   * `documentType` (or `''` when the caller omits it for the adapter to derive);
   * on a successful issue the service backfills the adapter-derived value so a
   * keyless / no-documentType call's projection reflects the real document type.
   */
  documentType?: string;
  providerInvoiceId?: string | null;
  providerInvoiceNumber?: string | null;
  regulatoryStatus?: RegulatoryStatus;
  clearanceReference?: string | null;
  /**
   * Neutral payment lifecycle (#1354). Set by the payment-status refresh
   * service from an authoritative `PaymentStatusReader` read; omitted otherwise
   * so an unrelated outcome patch never resets it.
   */
  paymentStatus?: PaymentStatus;
  pdfUrl?: string | null;
  issuedAt?: Date | null;
  errorMessage?: string | null;
  /**
   * Neutral failure discriminator (#1200). Set when patching a `failed` outcome
   * so the read-gate can tell a re-attemptable terminal rejection (`rejected`)
   * from an unsafe in-doubt transport failure (`in-doubt`). Cleared (`null`) on a
   * successful `issued` patch alongside `errorMessage`.
   */
  failureMode?: InvoiceFailureMode | null;
  /**
   * Neutral machine-readable failure code (W1). Set alongside `failureMode` when
   * patching a `failed` outcome so the FE can drive a cause-specific affordance
   * without parsing `errorMessage`. Cleared (`null`) on a successful `issued`
   * patch alongside `errorMessage` + `failureMode`.
   */
  failureCode?: InvoiceFailureCode | null;
  /**
   * Short, PII-free human-readable failure summary (W1). Set on a `failed` patch;
   * cleared (`null`) on a successful `issued` patch. Distinct from the
   * INTERNAL-ONLY, possibly-PII `errorMessage` — `failureReason` is safe to expose.
   */
  failureReason?: string | null;
  /**
   * Lease expiry for the `issuing` CAS claim (#1200). Set when an attempt claims
   * the in-flight slot; cleared (`null`) on the terminal `issued`/`failed` patch.
   */
  leaseExpiresAt?: Date | null;
  /** Neutral issued-document content snapshot (§7.3); `null` when not captured. */
  documentContent?: IssuedDocumentContent | null;
  /**
   * Persisted machine-readable source document (e.g. FA(3) XML), captured at
   * issue time from the adapter's {@link IssueInvoiceResult}. Write-once: set
   * on the first successful `issued` patch; the repository guards against
   * overwriting an existing snapshot. `null` when the adapter does not surface
   * a source document.
   */
  sourceDocument?: StoredDocument | null;
  /**
   * Issuance-time line snapshot (#1297). Set once on a successful `issued`
   * outcome — from the issue command for `issueInvoice`, or the post-correction
   * ("after") lines for `issueCorrection`. NOT write-once at the persistence
   * boundary (unlike `sourceDocument`): the service only ever sets it on the
   * single terminal `issued` patch. `null` when not captured.
   */
  issuedLineSnapshot?: IssuedLineSnapshot | null;
}
