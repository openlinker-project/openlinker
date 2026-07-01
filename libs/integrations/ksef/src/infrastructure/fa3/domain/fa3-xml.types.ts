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
import type { Fa3KodWaluty, Fa3P12Value } from './fa3-schema.types';

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
  /**
   * Connection-resolved fallback `P_12` neutral code (see
   * `DEFAULT_FA3_TAX_RATE` in `fa3-tax-rate.mapper.ts`), applied to any line
   * whose neutral `taxRate` arrives empty — core has no per-line tax rate to
   * give (ADR-026). Always a concrete value by the time this profile exists;
   * the factory resolves it (connection config or the PL standard default).
   */
  defaultTaxRate: string;
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
  currency: Fa3KodWaluty;
  /**
   * Invoice issue date (`P_1`), ISO-8601 calendar date `YYYY-MM-DD`. Supplied by
   * the adapter — the builder never derives "today".
   */
  issueDate: string;
  /** Invoice number (`P_2`) — the human-facing sequential document number. */
  invoiceNumber: string;
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
}

/**
 * Nominally-branded raw FA(3) XML string. The brand distinguishes a freshly
 * serialised (not-yet-validated) document from a structurally-validated one at
 * the type level, so a caller cannot accidentally skip the validator.
 */
export type RawFa3Xml = string & { readonly __brand: 'RawFa3Xml' };
