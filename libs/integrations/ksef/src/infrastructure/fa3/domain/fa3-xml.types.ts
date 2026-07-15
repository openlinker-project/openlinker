/**
 * FA(3) XML Structural Constants & Builder I/O Types
 *
 * Single source of truth for the FA(3) schema-identity constants (namespace,
 * form code, schema version, root element) and the value-object types that
 * flow into and out of the pure FA(3) builder. These are PL/KSeF specifics and
 * live exclusively in this package per ADR-026 — no NIP/KSeF/FA string ever
 * leaks back into `libs/core`.
 *
 * The namespace + form code are an immutable Ministry-of-Finance contract; a
 * future FA(3) minor revision (e.g. `1-0F`) changes only the `WERSJA_SCHEMY`
 * constant and the vendored XSD, not the wire layout. See
 * SCHEMA_VALIDATION_STATUS.md for the schema provenance + deferral flags.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/domain
 */
import type { BuyerAddress } from '@openlinker/core/invoicing';
import type { BuyerIdentity } from './fa3-buyer-id.mapper';
import type { Fa3FormaPlatnosci, Fa3KodWaluty, Fa3P12Value } from './fa3-schema.types';

/** FA(3) XML namespace (Ministry of Finance, wzór 2025/06/25/13775). */
export const FA3_NAMESPACE = 'http://crd.gov.pl/wzor/2025/06/25/13775/';

/** `KodFormularza` element value. */
export const FA3_FORM_CODE = 'FA';

/**
 * `KodFormularza/@kodSystemowy` — the Ministry-of-Finance *system code* for the
 * FA(3) form. This literal token is what KSeF expects in both the XML header
 * attribute and `OpenOnlineSessionRequest.formCode.systemCode`. It is NOT the
 * schema namespace URL (a common confusion the session-open request must avoid).
 */
export const FA3_SYSTEM_CODE = 'FA (3)';

/** `KodFormularza/@wersjaSchemy` + `WariantFormularza`-pinned schema version. */
export const FA3_SCHEMA_VERSION = '1-0E';

/** Root document element name. */
export const FA3_ROOT_ELEMENT = 'Faktura';

/**
 * `RodzajFaktury` value for a plain sales invoice (TRodzajFaktury enum, XSD line
 * ~1800). `VAT` = "Faktura podstawowa". Correction kinds (`KOR`, `KOR_ZAL`, …)
 * are out of scope here — they belong to the deferred KOR sequence (C7).
 */
export const FA3_RODZAJ_FAKTURY_VAT = 'VAT';

/**
 * `etd:TWybor1_2` "no" value. The MF 1/2 choice type where `1` = the annotation
 * applies ("yes") and `2` = it does not ("nie"). Every plain-sale `Adnotacje`
 * 1/2 flag (`P_16`, `P_17`, `P_18`, `P_18A`, `P_23`) defaults to `2`.
 */
export const FA3_WYBOR_NIE = '2';

/**
 * `etd:TWybor1` "set" value. Single-valued marker type whose only member is `1`.
 * Used for the negative branch of each `Adnotacje` choice group — `P_19N` (no
 * exemption), `P_22N` (no new means of transport), `P_PMarzyN` (no margin
 * scheme) — i.e. the "nothing special" path.
 */
export const FA3_WYBOR_TAK = '1';

/**
 * Seller identity + address — injected into the builder by the adapter (resolved
 * from connection config), never discovered inside the pure builder. `nip` is a
 * required system-configuration value (Podmiot1 always carries a seller NIP).
 */
export interface SellerProfile {
  nip: string;
  name: string;
  address: BuyerAddress;
}

/**
 * One FA(3) line (`FaWiersz`) after neutral→PL mapping. Monetary fields are kept
 * as `number` (core's money idiom); the builder formats them to fixed-decimal
 * strings at serialisation time. `p12` is the resolved tax-rate enum.
 */
export interface Fa3Line {
  name: string;
  quantity: number;
  unitPriceGross: number;
  p12: Fa3P12Value;
  /**
   * Unit of measure (`P_8A`, `TZnakowy` free text, #1525). Resolved by the
   * builder-input mapper with precedence: neutral `InvoiceLine.unit` -> the
   * connection's `invoiceDefaults.lineUnit` -> absent (element omitted).
   */
  unit?: string;
}

/**
 * FA(3) correction type (`TypKorekty`) — the Ministry-of-Finance enumeration of
 * how a KOR relates fiscally to the original:
 *
 * | Value | Meaning |
 * |---|---|
 * | `1`   | Correction in the original tax period (effect dated to the original) |
 * | `2`   | Correction of invoice line items (the return/refund default) |
 * | `3`   | Correction in the current period (effect dated to the KOR) |
 *
 * A return/refund corrects the supplied line items, so the adapter maps the
 * neutral correction to `2` by default; `1`/`3` are reserved for period-shifting
 * corrections a future rules layer may select.
 */
export const Fa3TypKorektyValues = ['1', '2', '3'] as const;
export type Fa3TypKorekty = (typeof Fa3TypKorektyValues)[number];

/** `RodzajFaktury` discriminator value for a plain correction invoice. */
export const FA3_RODZAJ_KOREKTA = 'KOR';

/**
 * Fully-mapped correction context (`KOR`). Present on {@link Fa3BuilderInput}
 * only when the document corrects a prior invoice. Carries the corrected
 * original's identity (`DaneFaKorygowanej`: date + number + KSeF-number choice),
 * the reason (`PrzyczynaKorekty`), the correction type (`TypKorekty`), and the
 * post-correction ("after") line state. The "before" line state is the builder
 * input's top-level `lines`; the builder emits the before/after rows the FA(3)
 * KOR model requires (`StanPrzed=1` on the "before" rows).
 */
export interface Fa3CorrectionContext {
  /** `TypKorekty` — return/refund maps to `2` (line-item correction). */
  typKorekty: Fa3TypKorekty;
  /** `PrzyczynaKorekty` — free-text reason; entity-escaped at serialisation. */
  reason: string;
  /** `DataWystFaKorygowanej` — corrected original issue date, ISO `YYYY-MM-DD`. */
  originalIssueDate: string;
  /** `NrFaKorygowanej` — corrected original's human-facing number. */
  originalInvoiceNumber: string;
  /**
   * `NrKSeF` of the corrected original — `null` when the original was NOT a KSeF
   * invoice, which the builder renders as `NrKSeFN=1` (the "no KSeF number" flag).
   */
  originalKsefNumber: string | null;
  /** Post-correction ("after") line state. */
  correctedLines: Fa3Line[];
}

/**
 * Manually-entered bank account resolved from the connection's
 * `KsefBankAccountConfig` (#1311) — never live-fetched, unlike inFakt's
 * `BankAccountsReader` capability. `nrRb` mirrors the XSD's own
 * required-others-optional shape (`TRachunekBankowy`, XSD line 1507).
 */
export interface Fa3BankAccount {
  nrRb: string;
  bankName?: string;
  swift?: string;
}

/**
 * Resolved connection-level payment defaults (#1311), emitted into the
 * optional `Fa/Platnosc` element. Every field is independently optional —
 * see `platnoscNode` in `fa3-xml.builder.ts` for the XSD-mandated emit order
 * (`TerminPlatnosci` → `FormaPlatnosci` → `RachunekBankowy` → `Skonto`).
 */
export interface Fa3PaymentInput {
  formaPlatnosci?: Fa3FormaPlatnosci;
  bankAccount?: Fa3BankAccount;
  paymentTermDays?: number;
  skonto?: { conditions: string; amount: string };
}

/**
 * XSD-mandated child order of the `Fa/Platnosc` sequence (FA(3) v1-0E, XSD
 * line 3281), restricted to the elements the builder can emit. The paid /
 * partial-payment choice group (`Zaplacono`/`ZaplataCzesciowa`, which nests its
 * own `FormaPlatnosci`) precedes these in the schema but is never emitted by
 * OpenLinker, so it is deliberately excluded — including it would make the
 * flat first-occurrence order check in `validateFa3Xml` false-positive on the
 * nested `FormaPlatnosci`.
 */
export const FA3_PLATNOSC_CHILD_ORDER = [
  'TerminPlatnosci',
  'FormaPlatnosci',
  'RachunekBankowy',
  'RachunekBankowyFaktora',
  'Skonto',
  'LinkDoPlatnosci',
] as const;

/**
 * XSD-mandated child order of `TRachunekBankowy` (XSD line 1507): the required
 * `NrRB` and optional `SWIFT` form an inner sequence that precedes the
 * remaining optional fields — notably `SWIFT` comes BEFORE `NazwaBanku`,
 * despite the reverse reading order feeling more natural (PR #1317 review).
 */
export const FA3_RACHUNEK_BANKOWY_CHILD_ORDER = [
  'NrRB',
  'SWIFT',
  'RachunekWlasnyBanku',
  'NazwaBanku',
  'OpisRachunku',
] as const;

/**
 * XSD-mandated child order of the `Fa` sequence (FA(3) v1-0E, XSD line ~2439),
 * restricted to the elements the builder can emit (#1525 review). Notably `P_6`
 * (the optional sale-date choice) sits between `P_2` and the `P_13_x`/`P_14_x`
 * band aggregates - a position regression fails the local validator instead of
 * KSeF clearance. Same flat first-occurrence caveat as the other order lists:
 * none of these names may also occur nested inside another listed element's
 * subtree (true for the builder's output - FaWiersz children are `P_7`/`P_8A`/
 * `P_8B`/`P_9A`/`P_11`/`P_12`, disjoint from this list).
 */
export const FA3_FA_CHILD_ORDER = [
  'KodWaluty',
  'P_1',
  'P_2',
  'P_6',
  'P_13_1',
  'P_14_1',
  'P_13_2',
  'P_14_2',
  'P_13_3',
  'P_14_3',
  'P_13_6_1',
  'P_13_6_2',
  'P_13_6_3',
  'P_13_7',
  'P_13_8',
  'P_13_9',
  'P_13_10',
  'P_15',
  'Adnotacje',
  'RodzajFaktury',
  'PrzyczynaKorekty',
  'TypKorekty',
  'DaneFaKorygowanej',
  'FaWiersz',
  'Platnosc',
] as const;

/**
 * XSD-mandated child order of the `FaWiersz` sequence (FA(3) v1-0E, XSD line
 * ~3080), restricted to the elements the builder can emit (#1525). Notably
 * `P_8A` (unit of measure) comes immediately before `P_8B` (quantity), and
 * `P_9A` (net unit price) immediately after `P_8B`; the `StanPrzed` KOR flag
 * closes the sequence. Absent optional elements are simply skipped.
 */
export const FA3_FA_WIERSZ_CHILD_ORDER = [
  'NrWierszaFa',
  'P_7',
  'P_8A',
  'P_8B',
  'P_9A',
  'P_11',
  'P_12',
  'StanPrzed',
] as const;

/**
 * Fully-mapped builder input. The adapter produces this from a neutral
 * `IssueInvoiceCommand` (applying the tax-rate, buyer-id and currency mappers)
 * so the pure builder never re-runs country-specific mapping — it only lays out
 * structure and escapes values.
 */
export interface Fa3BuilderInput {
  seller: SellerProfile;
  buyer: BuyerIdentity;
  buyerName: string;
  buyerAddress: BuyerAddress;
  /**
   * Operator-supplied buyer classification (#1580) mapped to the FA(3)
   * `JST`/`GV` flags on `Podmiot2`. `buyerIsPublicSectorEntity` → `JST`
   * (jednostka samorządu terytorialnego / local-government unit),
   * `buyerIsVatGroupMember` → `GV` (członek grupy VAT / VAT-group member).
   * Absent ⇒ the flag emits `2` ("does not apply"), the safe default for the
   * common B2C/B2B case. No order source carries these, so they arrive only via
   * the operator on a manual issue.
   */
  buyerIsPublicSectorEntity?: boolean;
  buyerIsVatGroupMember?: boolean;
  currency: Fa3KodWaluty;
  /**
   * Invoice issue date (`P_1`), ISO-8601 calendar date `YYYY-MM-DD`. Supplied by
   * the adapter — the builder never derives "today".
   */
  issueDate: string;
  /** Invoice number (`P_2`) — the human-facing sequential document number. */
  invoiceNumber: string;
  /**
   * Date of supply / sale (`P_6`), ISO-8601 calendar date `YYYY-MM-DD` (#1525).
   * Emitted whenever known - including when equal to `P_1` - at the
   * XSD-mandated position (the optional choice after `P_2`/`WZ`, XSD line
   * ~2471). Absent when the neutral command carries no sale date.
   */
  saleDate?: string;
  /**
   * Document-generation timestamp (`DataWytworzeniaFa`), ISO-8601 UTC instant
   * ending in `Z`. Part of the input so the builder stays pure — no `Date.now()`.
   */
  generatedAt: string;
  lines: Fa3Line[];
  /**
   * Correction context — present only for a KOR document. When set, the builder
   * stamps `RodzajFaktury=KOR`, the `DaneFaKorygowanej`/reason/type fields, and
   * the before/after line rows; when absent the document is a plain invoice.
   */
  correction?: Fa3CorrectionContext;
  /**
   * Resolved connection-level payment defaults (#1311). Absent when the
   * connection has nothing configured — the builder omits `Platnosc` entirely
   * in that case, so existing connections keep byte-identical output.
   */
  payment?: Fa3PaymentInput;
}

/**
 * Nominally-branded raw FA(3) XML string. The brand distinguishes a freshly
 * serialised (not-yet-validated) document from a structurally-validated one at
 * the type level, so a caller cannot accidentally skip the validator.
 */
export type RawFa3Xml = string & { readonly __brand: 'RawFa3Xml' };
