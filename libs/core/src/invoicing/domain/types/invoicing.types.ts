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
 *   - `invalid-currency`: a TERMINAL `rejected` failure caused by the document's
 *     settlement currency. In practice this is an ADAPTER PRE-CALL REFUSAL —
 *     the adapter rejected a missing or malformed currency before any provider
 *     round-trip (#2103) — which is precisely why it must not collapse into
 *     `provider-rejected`, whose copy asserts the PROVIDER rejected a request
 *     it never saw. A genuine provider-side currency rejection would classify
 *     here too if its text reached `classifyFailureCode`, but no shipped
 *     adapter routes one: inFakt's HTTP client deliberately keeps the provider
 *     body out of the error message (it can echo buyer PII) and core never
 *     reads `responseBody`, so such a rejection lands on `provider-rejected` —
 *     accurately, since the provider did reject it. Operator-fixable on the
 *     source order either way. Currency and ISO 4217 are country-agnostic
 *     vocabulary, so this stays ADR-026-clean.
 *   - `sale-classification-required`: a TERMINAL `rejected` failure caused by a
 *     missing per-connection sale classification (goods vs. services) — a
 *     required-but-unconfigured PLUGIN SETTING, not an order-data problem
 *     (#3031). Unlike `invalid-currency` this genuinely IS a provider-side
 *     rejection (the adapter has no signal to refuse the call pre-emptively —
 *     #2177/#2995 deliberately did not add a goods/service field to
 *     `InvoiceLine`), so it can only be detected reactively, by an adapter
 *     recognising its own provider's shape for "you must configure this" and
 *     re-throwing with a `reason` one of {@link SALE_CLASSIFICATION_REJECTION_MARKERS}
 *     matches. The operator-fixable remedy is a one-field connection config
 *     change, which is why this must not collapse into `provider-rejected` —
 *     that copy gives no clue there is a config knob to set at all.
 *   - `provider-rejected`: any other TERMINAL `rejected` failure (safe to
 *     re-attempt once the underlying input is corrected).
 *   - `transport-timeout`: an `in-doubt` transport failure — the document MAY
 *     exist; NEVER auto-re-attempted, surfaced for manual reconciliation.
 *   - `provider-error`: an unclassifiable failure (the fiscal-safe default code,
 *     paired with the `in-doubt` mode).
 */
export const InvoiceFailureCodeValues = [
  'buyer-tax-id-invalid',
  'invalid-currency',
  'sale-classification-required',
  'provider-rejected',
  'transport-timeout',
  'provider-error',
] as const;
export type InvoiceFailureCode = (typeof InvoiceFailureCodeValues)[number];

/**
 * Substrings (case-insensitive) that mark a `rejected` failure as a settlement-
 * currency problem, so `classifyFailureCode` can resolve `invalid-currency`
 * instead of the generic `provider-rejected` — whose operator-facing copy
 * asserts the PROVIDER rejected the request, which is untrue when an adapter
 * refuses the currency shape BEFORE any provider call (#2103).
 *
 * Deliberately narrow phrases rather than the bare word `currency`, which would
 * also match an unrelated provider message that merely mentions a currency
 * (e.g. an amount-formatting rejection) and mis-route the operator's fix.
 *
 * PUBLISHED (unlike the sibling tax-id markers, which stay private to
 * `InvoiceService`) because for this code BOTH ends of the structural read live
 * in this repo: the phrase an adapter throws pre-call is OL-authored, so an
 * adapter spec can assert its own message still matches one of these markers
 * and a reword breaks the build rather than silently degrading the operator's
 * failure reason (#2103 review). Neutral vocabulary only — "currency" and
 * "ISO 4217" name no country or tax system (ADR-026).
 */
export const CURRENCY_REJECTION_MARKERS = [
  'iso 4217',
  'invalid currency',
  'unsupported currency',
  'currency is required',
  'currency code',
] as const;

/**
 * Substrings (case-insensitive) that mark a `rejected` failure as a missing
 * per-connection sale-classification (goods vs. services) setting, so
 * `classifyFailureCode` can resolve `sale-classification-required` instead of
 * the generic `provider-rejected` (#3031, follow-up to #2177/#2995).
 *
 * Unlike the currency markers this is a genuine POST-CALL provider rejection —
 * core cannot know ahead of time whether the buyer's country needs the field,
 * and #2995 deliberately declined to add a goods/service signal to
 * `InvoiceLine` (a national VAT-classification concept ADR-026 keeps out of
 * `libs/core`). An adapter that recognises its own provider's "you must
 * configure a sale classification" response re-throws with a `reason`
 * matching one of these markers instead of propagating the provider's raw
 * (possibly buyer-PII-echoing) message.
 *
 * PUBLISHED for the same reason {@link CURRENCY_REJECTION_MARKERS} is: both
 * ends of the structural read live in this repo (the reason text an adapter
 * throws is OL-authored, never a verbatim provider string), so an adapter
 * spec can assert its own message still matches one of these markers and a
 * reword breaks the build rather than silently degrading the operator's
 * failure reason. Neutral vocabulary only — "sale classification" names no
 * country or tax system (ADR-026); it deliberately avoids inFakt's own wire
 * field name (`sale_type`) so the marker itself never leaks one provider's
 * naming into a cross-provider vocabulary, even though inFakt is the only
 * shipped adapter that triggers it today.
 */
export const SALE_CLASSIFICATION_REJECTION_MARKERS = ['sale classification'] as const;

/**
 * Neutral Continuous-Transaction-Controls clearance lifecycle. The adapter maps
 * a regime's native states (KSeF, IT SDI, ES SII…) onto these. `not-applicable`
 * is the default for providers without regulatory transmission.
 *
 * `pending-submission` (#1700) is the deferred-submission window: a document
 * that has been ISSUED with legal effect but not yet transmitted to the
 * authority, because the authority was unreachable at issuance and the regime
 * permits a bounded degraded-mode grace period. It is regime-neutral by design
 * — several CTC regimes offer an analogous outage-tolerance window, so the
 * name deliberately avoids any single regime's label. It is NON-terminal: a
 * background sweep later resubmits the document and advances it to `submitted`
 * (see {@link OfflineResubmitter}).
 */
export const RegulatoryStatusValues = [
  'not-applicable',
  'pending-submission',
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
 * Outcome of an offline-resubmission attempt (#1700). Returned by
 * `OfflineResubmitter.resubmit` when a background sweep retransmits a document
 * that was issued during a degraded-mode outage (`pending-submission`). Carries
 * the full triple the caller persists via `updateOutcome` so no field is lost
 * when a resubmit both advances the status AND surfaces the authority reference
 * the original offline issuance could not know. A business verdict (incl.
 * `rejected`) is carried as data; a transport/infra failure throws.
 */
export interface OfflineResubmitResult {
  /** Neutral CTC clearance lifecycle the resubmit yielded (`submitted`/`cleared`/…). */
  regulatoryStatus: RegulatoryStatus;
  /** Provider-native document id assigned at (re)submission, or `null` if unchanged. */
  providerInvoiceId: string | null;
  /** Authority-assigned reference now known, or `null` until the authority assigns one. */
  clearanceReference: string | null;
}

/**
 * Neutral criteria for the last-resort "find it on the authority's side" lookup
 * (#1700). Backs crash recovery: after a process died mid-submit, OL cannot know
 * from its own state whether the authority actually received the document, so it
 * queries the authority by whatever business coordinates it holds. Every field is
 * optional — an adapter uses the subset its provider's query surface supports.
 * Country/regulatory-agnostic: `sellerTaxId` is a scheme-tagged identifier value
 * the adapter interprets, never a named national id.
 */
export interface RegulatoryLocateCriteria {
  sellerTaxId?: string;
  documentNumber?: string;
  issuedFrom?: Date;
  issuedTo?: Date;
}

/**
 * Outcome of a {@link RegulatoryLocateCriteria} lookup (#1700). Returned by
 * `RegulatoryRecordLocator.locateByQuery` when the authority holds a matching
 * document, or `null` when it does not (the caller then treats the original
 * attempt as never having landed). Mirrors the persist-triple shape so the
 * recovery sweep reconciles OL's record with no translation.
 */
export interface RegulatoryLocateResult {
  /** Provider-native document id the authority reports for the match, or `null`. */
  providerInvoiceId: string | null;
  /** Neutral CTC clearance lifecycle the authority reports for the located document. */
  regulatoryStatus: RegulatoryStatus;
  /** Authority-assigned reference for the located document, or `null` if none yet. */
  clearanceReference: string | null;
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
 * Tax identifier — EN 16931 BT-30 / ISO 6523 / Stripe `tax_ids` shape.
 *
 * `scheme` is an OPEN string the adapter interprets (`pl-nip`, `eu-vat`,
 * `de-ustid`); core never names a country's identifier system.
 *
 * It is OPTIONAL, and the absence is meaningful rather than a convenience
 * (#3224, ADR-073 decision 1). An `Order` stores a bare tax number with no
 * tag, so the auto-issue path has a value and no scheme — and minting one
 * in core is exactly what ADR-073 forbids, because the tag names a country's
 * identifier system and a mis-set one silently mislabels every document.
 * ADR-073's own words: *"An adapter needing a tag supplies it."* The seller's
 * identity already works this way (the KSeF adapter resolves `pl-nip` from its
 * own connection config), so this is the same rule applied to the buyer.
 *
 * **An adapter must therefore treat an absent `scheme` as "untagged, decide
 * for your own market", never as "not a tax id".** Dropping the value there
 * silently omits the buyer's tax number from a document that legally needs it.
 * A value the provider then refuses is surfaced verbatim (ADR-073 decision 5);
 * core never pre-judges which identifiers a provider accepts.
 */
export interface TaxIdentifier {
  scheme?: string;
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
 *
 * **`taxRate` notation is percent-as-string (#2247):** `'23'` means twenty-three
 * percent, `'0'` means a zero rate, and a non-numeric code (`zw`, `np`, `oo`)
 * names an exemption that carries no percentage. Fractional notation (`'0.23'`)
 * is **not** an alternative spelling - it is rejected, because read as a
 * percentage it means 0.23% and nothing in the value says which was intended.
 * Every reader goes through `parseTaxRatePercent` / `taxRatePercentToFraction`
 * (`./tax-rate-notation.types`) rather than parsing the string itself.
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
  /**
   * The OL-internal product id this line sells, when the caller knows it - the
   * same id `OrderItem.productId` carries, so a provider resolves it to its own
   * catalogue key through `identifier_mappings` exactly as the order-creation
   * path already does.
   *
   * OPTIONAL and provider-ignorable, the `unit` precedent above: a line that is
   * not a catalogue item at all (a shipping charge, a manual adjustment) has no
   * product and legitimately omits it, and a provider whose documents carry no
   * catalogue concept never reads it.
   *
   * It exists because a document whose lines name a product only in free text
   * is not linked to the goods: on Subiekt such a line is a "usługa
   * jednorazowa" (one-time service) and therefore moves no stock, so the seller
   * sells an item and their warehouse never registers it leaving. Carrying the
   * id lets the provider emit a real catalogue line instead. NEVER a substitute
   * for `name`, which stays the human-readable text the document prints.
   */
  productId?: string;
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
  /**
   * Buyer e-mail, or `null` when unknown (#1797). `InvoiceService` persists
   * `IssuedLineSnapshot.buyer` verbatim from the issue command's `BuyerProfile`
   * (no field-by-field recomputation), so this field round-trips through jsonb
   * for free once `BuyerProfile` carries it — declared here so the type stays
   * honest about what's actually persisted. Not read back into a real send
   * flow: the correction path that rebuilds a `BuyerProfile` from this shape
   * never calls `sendByEmail`.
   */
  email: string | null;
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
   * Optional neutral order-origin axis for numbering routing (#1694) — the
   * source connection's `platformType` / marketplace-of-origin. Routes numbering
   * to the connection's series scoped to this source; when absent the routing
   * falls back past the source axis (source is the most-specific, first-dropped
   * axis). Country-agnostic (ADR-026): an opaque neutral string, never a
   * hardcoded marketplace name. Ignored by providers that number documents
   * themselves.
   */
  source?: string;
  /**
   * OpenLinker-allocated legal document number (#1575). Set by the core
   * `InvoiceService` ONLY when the resolved adapter passes
   * `isDocumentNumberConsumer` (today: KSeF) — the adapter then uses it for its
   * legal number (KSeF FA(3) `P_2`) and echoes it as
   * `InvoiceRecord.providerInvoiceNumber` (single source, #1338). Absent for a
   * provider that numbers documents itself (inFakt/Subiekt).
   */
  documentNumber?: string;
  /**
   * The order's tax-rate era (#2245 review) - `'pre-rollout'` for an order that
   * arrived before per-line rates existed, absent/`null` for everything after.
   *
   * Read ONLY by the write-path tax-rate guard, which exempts a pre-rollout
   * order so it issues exactly as it did before the epic (ADR-063
   * § Consequences). It is not sent to any provider and never reaches a
   * document.
   *
   * Carried on the command rather than read back from the order record, because
   * `InvoiceService` depends on no orders-context token and adding one to answer
   * a marker question would be a new module edge. Every issuance caller already
   * has the record in hand.
   */
  taxRateEra?: string | null;
  /**
   * The buyer tax identity KNOWN AT ISSUE TIME, in the same three-state
   * encoding `order_records.buyerTaxId` uses (#2599): `null`/absent = the
   * source asserted nothing, `''` = it positively asserted the buyer has none,
   * otherwise the id.
   *
   * Frozen onto {@link InvoiceRecord.buyerTaxId} so the invoice list can render
   * the three states the order detail renders (#3188) without joining to the
   * Order — and, more importantly, without MOVING: an invoice is an immutable
   * fiscal document, while `order_records.buyerTaxId` is rewritten by every
   * re-ingestion, so a joined read could later show a number the issued
   * document does not carry.
   *
   * Carried on the command for the same reason {@link taxRateEra} above is:
   * `InvoiceService` depends on no orders-context token, and adding one would
   * be a new module edge into the context whose module already imports this
   * one. Every issuance caller has the value in hand.
   *
   * It never reaches a provider and never appears on a document — the id the
   * document carries is `buyer.taxId`, and the write path refuses to let this
   * field contradict it.
   */
  buyerTaxIdAssertion?: string | null;
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
  /**
   * Optional neutral order-origin axis for numbering routing (#1694) — the
   * source connection's `platformType` / marketplace-of-origin. Routes the
   * correction's numbering to the series scoped to this source; falls back past
   * the source axis when absent. Country-agnostic (ADR-026). The correction's
   * currency axis is taken from `originalDocument.currency`.
   */
  source?: string;
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
/**
 * Per-line amounts **as the issued document states them** (#2251, ADR-063 § 5).
 *
 * Core computes no net and rounds nothing, so a stored per-line net has to be a
 * COPY of the document's own figure rather than a recomputation - otherwise it
 * disagrees with the paper by a grosz here and there and no reader can tell
 * which is right.
 *
 * Matched to the command's lines by 1-based `lineNumber`, which is the position
 * on the document. Shipping lines are part of that numbering (they are real
 * document lines) - what "skip shipping" means downstream is that they have no
 * ORDER line to transcribe onto, not that they shift the numbering.
 *
 * An adapter reports this only when it can. inFakt and Subiekt read it off the
 * provider's response; KSeF is the calculator (OpenLinker builds the FA(3)
 * itself), so it reports the figures it put in the XML. An adapter that has
 * neither omits the field, and core falls back to its own non-authoritative
 * recomputation for those lines.
 */
export interface IssuedDocumentLineAmounts {
  /** 1-based position on the document. */
  lineNumber: number;
  /** Net price of one unit, as the document states it. */
  unitNet: number;
  /** Net value of the line. */
  net: number;
  /** Tax amount of the line. */
  tax: number;
  /** Gross value of the line. */
  gross: number;
}

export interface IssueInvoiceResult {
  record: InvoiceRecord;
  seller?: IssuedDocumentSeller;
  /**
   * The document's OWN per-line amounts (#2251). Present makes
   * `IssuedDocumentContent.lines` authoritative for those lines instead of a
   * recomputation; absent keeps the pre-#2251 behaviour.
   */
  documentLines?: IssuedDocumentLineAmounts[];
  /**
   * OPTIONAL machine-readable source document the adapter built and submitted to
   * the authority (PL/KSeF: the FA(3) XML). Core persists it as an opaque
   * {@link StoredDocument} at issue time so `GET .../document?kind=source` can
   * re-serve it without a provider round-trip. Adapters that do not expose a
   * source document omit it.
   */
  sourceDocument?: StoredDocument;
  /**
   * How many of the document's lines the provider could NOT link to a record in
   * its own catalogue, and therefore issued as free text.
   *
   * TRI-STATE, and the distinction is the point:
   *   - `undefined` — this provider does not report linkage at all. Most do
   *     not: a provider with no catalogue and no warehouse has nothing to say.
   *   - `0` — every line was linked.
   *   - `> 0` — that many lines were not, so anything the provider derives
   *     from its catalogue does not reflect them. On a warehouse-backed
   *     provider that means the goods left and the stock never moved.
   *
   * It exists because such a document looks completely normal — correct name,
   * quantity, price and VAT on every line — while the seller's warehouse never
   * registers the sale. The only previous signal was a log line.
   *
   * It is the provider's PRE-SUBMIT belief about linkage, not a confirmation
   * from the provider that the lines were filed as linked. `0` therefore means
   * "we sent a catalogue key for every line", NOT "the provider accepted every
   * key" — a bridge or API can still drop one downstream.
   */
  unlinkedCatalogueLines?: number;
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
  /**
   * The buyer tax identity frozen at issue time (#3188), three-state encoded as
   * `order_records.buyerTaxId` is: `null` = not asserted, `''` = asserted-none,
   * otherwise the id the document carries. Read it back through
   * `decodeBuyerTaxIdColumn`, never with a bare `!== null` — that reports true
   * for the asserted-none row.
   */
  buyerTaxId?: string | null;
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
  /**
   * Free-text match against `orderId`, `providerInvoiceNumber`, and
   * `clearanceReference` (#3306). Case-insensitive, partial.
   */
  search?: string;
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
  /** See {@link IssueInvoiceResult.unlinkedCatalogueLines}. Written on the issued patch only. */
  unlinkedCatalogueLines?: number | null;
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

/**
 * Row-value keyset position for {@link InvoiceRecordRepositoryPort.findManyKeyset}
 * (#3306) - `(createdAt, id)`, the same shape `findIssuedNonTerminal` already
 * uses. `undefined` on the incoming request means "first page"; `null` on the
 * outgoing page means "no more rows."
 */
export interface InvoiceRecordKeysetCursor {
  createdAt: Date;
  id: string;
}
