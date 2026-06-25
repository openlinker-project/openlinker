/**
 * FA(3) XML Builder — Pure Function
 *
 * The core neutral→FA(3) serialiser. A pure, synchronous function: it takes
 * fully-mapped `Fa3BuilderInput` (the adapter has already applied the tax-rate /
 * buyer-id / currency mappers) plus a seller profile, and returns raw FA(3) XML.
 * No `async`, no I/O, no `Date.now()` (any timestamp is part of the input), no
 * credential access — which makes it trivially testable and safe to reuse in any
 * execution context (ADR-026: all PL/FA specifics live here, never in core).
 *
 * It builds a plain object tree and serialises via {@link serializeXml}, so
 * every user-supplied value is entity-escaped — the builder NEVER hand-concats
 * XML strings. The document is laid out as: Naglowek (KodFormularza + version +
 * namespace), Podmiot1 (seller NIP + address), Podmiot2 (buyer identification
 * choice), Fa (KodWaluty, P_1, P_2, the P_13/P_14/P_15 aggregates, the required
 * Adnotacje, the required RodzajFaktury, then one FaWiersz per line) — emitted in
 * the exact element order the FA(3) v1-0E XSD mandates.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/builders
 */
import type { BuyerAddress } from '@openlinker/core/invoicing';
import type { BuyerIdentity } from '../domain/fa3-buyer-id.mapper';
import type { Fa3P12Value } from '../domain/fa3-schema.types';
import {
  FA3_FORM_CODE,
  FA3_NAMESPACE,
  FA3_RODZAJ_FAKTURY_VAT,
  FA3_RODZAJ_KOREKTA,
  FA3_SCHEMA_VERSION,
  FA3_SYSTEM_CODE,
  FA3_WYBOR_NIE,
  FA3_WYBOR_TAK,
  type Fa3BuilderInput,
  type Fa3CorrectionContext,
  type Fa3Line,
  type RawFa3Xml,
  type SellerProfile,
} from '../domain/fa3-xml.types';
import { serializeXml, XML_ATTR_PREFIX, type XmlNode, type XmlNodeObject } from './xml-dom.builder';

/** Number of decimal places FA(3) monetary fields are rendered to. */
const MONEY_SCALE = 2;

/**
 * Max fraction digits FA(3) renders a quantity (`P_8B`, type `TIlosci`) to.
 * `TIlosci` = decimal, ≤22 total digits, ≤6 fraction digits (XSD line ~1245).
 */
const QUANTITY_SCALE = 6;

/**
 * FA(3) VAT-band → target element(s) map, keyed by `P_12`. These are **fixed
 * semantic bands** in the XSD (not free indices): each `P_12` value maps to a
 * specific `P_13_x` net-base element, and positive-rate bands additionally carry
 * a `P_14_x` VAT-amount element. The XSD declares the bands in this order
 * (P_13_1, P_13_2, P_13_3, then the standalone P_13_6_1/6_2/6_3, P_13_7, P_13_8,
 * P_13_10, …); `BAND_EMIT_ORDER` below pins the emit order independently of the
 * `P_12` enum order so the document is always XSD-ordered.
 *
 * Legal mapping (verified against the vendored FA(3) v1-0E XSD annotations):
 * - `23`/`8`/`5`         → standard / reduced-1 / reduced-2 (net + VAT)
 * - `0 KR`               → domestic 0% (P_13_6_1, net only)
 * - `0 WDT`              → intra-EU supply 0% (P_13_6_2, net only)
 * - `0 EX`               → export 0% (P_13_6_3, net only)
 * - `zw`                 → exempt (P_13_7, net only)
 * - `np`                 → supply outside PL territory (P_13_8, net only)
 * - `oo`                 → domestic reverse charge (P_13_10, net only)
 */
const VAT_BANDS: Readonly<Record<Fa3P12Value, { net: string; vat?: string; rate: number }>> = {
  '23': { net: 'P_13_1', vat: 'P_14_1', rate: 0.23 },
  '8': { net: 'P_13_2', vat: 'P_14_2', rate: 0.08 },
  '5': { net: 'P_13_3', vat: 'P_14_3', rate: 0.05 },
  '0 KR': { net: 'P_13_6_1', rate: 0 },
  '0 WDT': { net: 'P_13_6_2', rate: 0 },
  '0 EX': { net: 'P_13_6_3', rate: 0 },
  zw: { net: 'P_13_7', rate: 0 },
  np: { net: 'P_13_8', rate: 0 },
  oo: { net: 'P_13_10', rate: 0 },
};

/**
 * XSD-declared emit order of the net-base elements (P_13_1, P_13_2, P_13_3,
 * P_13_6_1, P_13_6_2, P_13_6_3, P_13_7, P_13_8, P_13_9, P_13_10, P_13_11). We
 * only populate the bands the builder supports today; the others stay absent
 * (all `minOccurs="0"`). The list pins the relative order regardless of which
 * bands a given invoice actually fills.
 */
const BAND_EMIT_ORDER: ReadonlyArray<Fa3P12Value> = [
  '23',
  '8',
  '5',
  '0 KR',
  '0 WDT',
  '0 EX',
  'zw',
  'np',
  'oo',
];

/**
 * Round a number to 2dp and render as a fixed-decimal string. Rounding is
 * arithmetic half-up (`Math.round` on the cent-scaled value). NOTE: half-up at
 * 2dp is provisional pending KSeF per-band rounding confirmation (whether VAT is
 * rounded per-line or per-band, and the exact tie-break) — C3+ reconciliation.
 */
function money(value: number): string {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(MONEY_SCALE);
}

/**
 * Per-line net (`P_11` = "wartość sprzedaży NETTO"). For a positive-rate band
 * the gross line is divided out (`net = gross / (1 + rate)`); zero-rate / exempt
 * / reverse-charge bands carry net = gross (no embedded VAT). This is the single
 * source of per-line net so the line `P_11` and the band `P_13_x` aggregation
 * can never drift.
 */
function lineNet(line: Fa3Line): number {
  const band = VAT_BANDS[line.p12];
  const gross = line.quantity * line.unitPriceGross;
  return band.rate > 0 ? gross / (1 + band.rate) : gross;
}

/**
 * Render a line quantity (`P_8B`, `TIlosci`). Fixed-decimal to avoid exponential
 * notation for large quantities; trailing zeros (and a bare trailing dot) are
 * trimmed so an integer quantity renders as `2`, not `2.000000`. Contract:
 * decimal string, ≤6 fraction digits — matching `TIlosci`.
 */
function quantity(value: number): string {
  const fixed = value.toFixed(QUANTITY_SCALE);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** Seller / Podmiot1 address → FA(3) `Adres` element. */
function addressNode(address: BuyerAddress): XmlNodeObject {
  const adres: XmlNodeObject = {
    KodKraju: address.countryIso2,
    AdresL1: address.line1,
  };
  if (address.line2 !== null && address.line2 !== '') {
    adres.AdresL2 = address.line2;
  }
  return adres;
}

/** Build the buyer `Podmiot2` identification element from the resolved choice. */
function buyerIdentificationNode(buyer: BuyerIdentity): XmlNodeObject {
  switch (buyer.kind) {
    case 'nip':
      return { NIP: buyer.nip };
    case 'vat':
      return { KodUE: buyer.countryCode, NrVatUE: buyer.vatNumber };
    case 'other':
      return { KodKraju: buyer.countryCode, NrID: buyer.id };
    case 'none':
      return { BrakID: 1 };
  }
}

/**
 * One `FaWiersz` element for a line at 1-based ordinal `ordinal`. On a KOR the
 * "before" rows carry `StanPrzed=1` (the FA(3) before/after correction model);
 * a plain invoice and the KOR "after" rows omit it.
 */
function lineNode(line: Fa3Line, ordinal: number, stanPrzed = false): XmlNodeObject {
  const node: XmlNodeObject = {
    NrWierszaFa: ordinal,
    P_7: line.name,
    P_8B: quantity(line.quantity),
    // P_11 is the line's NET sale value — never the gross. Shared with the
    // band aggregation via `lineNet` so the two can't diverge.
    P_11: money(lineNet(line)),
    P_12: line.p12,
  };
  if (stanPrzed) {
    node.StanPrzed = 1;
  }
  return node;
}

/**
 * Aggregate per-line nets into FA(3) VAT-band totals. Each `P_12` maps to a
 * fixed `P_13_x` net element (via `VAT_BANDS`); positive-rate bands additionally
 * accumulate the VAT delta into their `P_14_x`. Bands are emitted in
 * XSD-declared order (`BAND_EMIT_ORDER`) with each `P_13_x` immediately followed
 * by its `P_14_x` when present, matching the schema's per-rate sequence. Returns
 * the populated band fields plus the `P_15` grand total (sum of gross lines).
 */
function aggregateTotals(lines: Fa3Line[]): { bands: XmlNodeObject; grandTotal: number } {
  const netByBand = new Map<Fa3P12Value, number>();
  const vatByBand = new Map<Fa3P12Value, number>();
  let grandTotal = 0;

  for (const line of lines) {
    const band = VAT_BANDS[line.p12];
    const gross = line.quantity * line.unitPriceGross;
    const net = lineNet(line);
    netByBand.set(line.p12, (netByBand.get(line.p12) ?? 0) + net);
    if (band.vat !== undefined) {
      vatByBand.set(line.p12, (vatByBand.get(line.p12) ?? 0) + (gross - net));
    }
    grandTotal += gross;
  }

  const bands: XmlNodeObject = {};
  for (const p12 of BAND_EMIT_ORDER) {
    const net = netByBand.get(p12);
    if (net === undefined) {
      continue;
    }
    const target = VAT_BANDS[p12];
    bands[target.net] = money(net);
    if (target.vat !== undefined) {
      bands[target.vat] = money(vatByBand.get(p12) ?? 0);
    }
  }
  return { bands, grandTotal };
}

/** The document header (`Naglowek`). */
function headerNode(input: Fa3BuilderInput): XmlNodeObject {
  return {
    KodFormularza: {
      [`${XML_ATTR_PREFIX}kodSystemowy`]: FA3_SYSTEM_CODE,
      [`${XML_ATTR_PREFIX}wersjaSchemy`]: FA3_SCHEMA_VERSION,
      '#text': FA3_FORM_CODE,
    },
    WariantFormularza: 3,
    DataWytworzeniaFa: input.generatedAt,
  };
}

/** The seller party (`Podmiot1`). */
function sellerNode(seller: SellerProfile): XmlNodeObject {
  return {
    DaneIdentyfikacyjne: { NIP: seller.nip, Nazwa: seller.name },
    Adres: addressNode(seller.address),
  };
}

/** The buyer party (`Podmiot2`). */
function buyerNode(input: Fa3BuilderInput): XmlNodeObject {
  return {
    DaneIdentyfikacyjne: {
      ...buyerIdentificationNode(input.buyer),
      Nazwa: input.buyerName,
    },
    Adres: addressNode(input.buyerAddress),
  };
}

/**
 * `DaneFaKorygowanej` — identity of the corrected original. The KSeF-number
 * choice is mutually exclusive: a `NrKSeF` when the original was a KSeF invoice,
 * else `NrKSeFN=1` (the "original had no KSeF number" flag).
 */
function correctedInvoiceNode(correction: Fa3CorrectionContext): XmlNodeObject {
  const node: XmlNodeObject = {
    DataWystFaKorygowanej: correction.originalIssueDate,
    NrFaKorygowanej: correction.originalInvoiceNumber,
  };
  if (correction.originalKsefNumber !== null && correction.originalKsefNumber !== '') {
    node.NrKSeF = correction.originalKsefNumber;
  } else {
    node.NrKSeFN = 1;
  }
  return node;
}

/**
 * The KOR before/after `FaWiersz` rows: every "before" (original) line first,
 * each flagged `StanPrzed=1`, then every "after" (corrected) line. Ordinals run
 * continuously across both blocks.
 */
function correctionLineNodes(input: Fa3BuilderInput, correction: Fa3CorrectionContext): XmlNode {
  const before = input.lines.map((line, idx) => lineNode(line, idx + 1, true));
  const after = correction.correctedLines.map((line, idx) =>
    lineNode(line, input.lines.length + idx + 1),
  );
  return [...before, ...after];
}

/**
 * The required `Adnotacje` block (XSD line ~2641) emitted with the "nothing
 * special" defaults for a plain domestic sale: every `etd:TWybor1_2` flag set to
 * "no" (`2`), and each choice group taking its negative branch (`P_19N`, `P_22N`,
 * `P_PMarzyN`, all `etd:TWybor1` = `1`). The schema-mandated child order is
 * P_16, P_17, P_18, P_18A, Zwolnienie, NoweSrodkiTransportu, P_23, PMarzy.
 */
function adnotacjeNode(): XmlNodeObject {
  return {
    P_16: FA3_WYBOR_NIE,
    P_17: FA3_WYBOR_NIE,
    P_18: FA3_WYBOR_NIE,
    P_18A: FA3_WYBOR_NIE,
    Zwolnienie: { P_19N: FA3_WYBOR_TAK },
    NoweSrodkiTransportu: { P_22N: FA3_WYBOR_TAK },
    P_23: FA3_WYBOR_NIE,
    PMarzy: { P_PMarzyN: FA3_WYBOR_TAK },
  };
}

/**
 * The invoice body (`Fa`). Elements are emitted in schema order (XSD line ~2439):
 * KodWaluty, P_1, P_2, the P_13_x/P_14_x VAT-band aggregates, P_15 grand total,
 * the required `Adnotacje`, the required `RodzajFaktury` (`VAT` for a plain sale,
 * `KOR` for a correction), the correction metadata (KOR only:
 * `PrzyczynaKorekty`/`TypKorekty`/`DaneFaKorygowanej`), then the `FaWiersz` rows.
 */
function faNode(input: Fa3BuilderInput): XmlNodeObject {
  const { correction } = input;
  // KOR aggregates reflect the post-correction ("after") state; a plain invoice
  // aggregates its own lines.
  const totalsSource = correction !== undefined ? correction.correctedLines : input.lines;
  const { bands, grandTotal } = aggregateTotals(totalsSource);
  const wiersze: XmlNode =
    correction !== undefined
      ? correctionLineNodes(input, correction)
      : input.lines.map((line, idx) => lineNode(line, idx + 1));

  const node: XmlNodeObject = {
    KodWaluty: input.currency,
    P_1: input.issueDate,
    P_2: input.invoiceNumber,
    ...bands,
    P_15: money(grandTotal),
    Adnotacje: adnotacjeNode(),
    RodzajFaktury: correction !== undefined ? FA3_RODZAJ_KOREKTA : FA3_RODZAJ_FAKTURY_VAT,
  };
  if (correction !== undefined) {
    // The KOR correction metadata follows RodzajFaktury in schema order, before
    // the FaWiersz rows.
    node.PrzyczynaKorekty = correction.reason;
    node.TypKorekty = correction.typKorekty;
    node.DaneFaKorygowanej = correctedInvoiceNode(correction);
  }
  node.FaWiersz = wiersze;
  return node;
}

/**
 * Build an FA(3) document (unvalidated) from fully-mapped input. Pure +
 * synchronous; validation is a separate downstream step.
 */
export function buildFa3Xml(input: Fa3BuilderInput): RawFa3Xml {
  const faktura: XmlNodeObject = {
    [`${XML_ATTR_PREFIX}xmlns`]: FA3_NAMESPACE,
    Naglowek: headerNode(input),
    Podmiot1: sellerNode(input.seller),
    Podmiot2: buyerNode(input),
  };
  if (input.correction !== undefined) {
    // KOR carries corrected-party snapshots (`Podmiot1K`/`Podmiot2K`). OL does
    // not track party changes across a correction, so they snapshot the same
    // seller/buyer identity as the corrected original.
    faktura.Podmiot1K = sellerNode(input.seller);
    faktura.Podmiot2K = buyerNode(input);
  }
  faktura.Fa = faNode(input);
  const tree: XmlNodeObject = { Faktura: faktura };
  return serializeXml(tree) as RawFa3Xml;
}
