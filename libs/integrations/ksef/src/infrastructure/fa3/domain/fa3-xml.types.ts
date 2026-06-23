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
export const FA3_NAMESPACE = 'http://crd.gov.pl/wzor/2025/06/25/13775/' as const;

/** `KodFormularza` element value. */
export const FA3_FORM_CODE = 'FA' as const;

/** `KodFormularza/@wersjaSchemy` + `WariantFormularza`-pinned schema version. */
export const FA3_SCHEMA_VERSION = '1-0E' as const;

/** Root document element name. */
export const FA3_ROOT_ELEMENT = 'Faktura' as const;

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
  /** Echoed into `Adnotacje` for traceability — the neutral order id. */
  orderReference: string;
  lines: Fa3Line[];
}

/**
 * Nominally-branded raw FA(3) XML string. The brand distinguishes a freshly
 * serialised (not-yet-validated) document from a structurally-validated one at
 * the type level, so a caller cannot accidentally skip the validator.
 */
export type RawFa3Xml = string & { readonly __brand: 'RawFa3Xml' };
