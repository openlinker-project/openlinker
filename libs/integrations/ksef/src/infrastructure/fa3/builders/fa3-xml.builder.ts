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
 * choice), Fa (header: KodWaluty, P_13/P_14/P_15 aggregates, Adnotacje), and one
 * FaWiersz per line.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/builders
 */
import type { BuyerAddress } from '@openlinker/core/invoicing';
import type { BuyerIdentity } from '../domain/fa3-buyer-id.mapper';
import type { Fa3P12Value } from '../domain/fa3-schema.types';
import {
  FA3_FORM_CODE,
  FA3_NAMESPACE,
  FA3_RODZAJ_KOREKTA,
  FA3_SCHEMA_VERSION,
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
 * FA(3) VAT bands carrying a net base (`P_13_x`) + VAT amount (`P_14_x`). Only
 * the positive-rate bands aggregate VAT; zero-rate / exempt / reverse-charge map
 * to their own net-only band. Each entry pins the `P_12` value to the band index
 * and the percentage used to split gross into net + VAT.
 */
const VAT_BANDS: ReadonlyArray<{ p12: Fa3P12Value; index: number; rate: number }> = [
  { p12: '23', index: 1, rate: 0.23 },
  { p12: '8', index: 2, rate: 0.08 },
  { p12: '5', index: 3, rate: 0.05 },
  { p12: '0 KR', index: 6, rate: 0 },
  { p12: '0 WDT', index: 5, rate: 0 },
  { p12: '0 EX', index: 4, rate: 0 },
  { p12: 'zw', index: 7, rate: 0 },
  { p12: 'oo', index: 8, rate: 0 },
  { p12: 'np', index: 9, rate: 0 },
];

/** Round a number to 2dp and render as a fixed-decimal string. */
function money(value: number): string {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(MONEY_SCALE);
}

/** Render a line quantity (`P_8B`) — kept as the raw numeric string. */
function quantity(value: number): string {
  return String(value);
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
    P_11: money(line.quantity * line.unitPriceGross),
    P_12: line.p12,
  };
  if (stanPrzed) {
    node.StanPrzed = 1;
  }
  return node;
}

/**
 * Aggregate per-line gross into FA(3) VAT-band totals. For positive-rate bands a
 * gross line is split into net (`P_13_x`) + VAT (`P_14_x`); zero/exempt bands
 * carry net only. Returns the populated band fields plus the `P_15` grand total.
 */
function aggregateTotals(lines: Fa3Line[]): { bands: XmlNodeObject; grandTotal: number } {
  const netByBand = new Map<number, number>();
  const vatByBand = new Map<number, number>();
  let grandTotal = 0;

  for (const line of lines) {
    const band = VAT_BANDS.find((b) => b.p12 === line.p12);
    if (band === undefined) {
      continue;
    }
    const gross = line.quantity * line.unitPriceGross;
    const net = band.rate > 0 ? gross / (1 + band.rate) : gross;
    const vat = gross - net;
    netByBand.set(band.index, (netByBand.get(band.index) ?? 0) + net);
    if (band.rate > 0) {
      vatByBand.set(band.index, (vatByBand.get(band.index) ?? 0) + vat);
    }
    grandTotal += gross;
  }

  const bands: XmlNodeObject = {};
  for (const [index, net] of netByBand) {
    bands[`P_13_${index}`] = money(net);
  }
  for (const [index, vat] of vatByBand) {
    bands[`P_14_${index}`] = money(vat);
  }
  return { bands, grandTotal };
}

/** The document header (`Naglowek`). */
function headerNode(input: Fa3BuilderInput): XmlNodeObject {
  return {
    KodFormularza: {
      [`${XML_ATTR_PREFIX}kodSystemowy`]: 'FA (3)',
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

/** The invoice body (`Fa`) — header fields, VAT aggregates, lines, Adnotacje. */
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
  };
  if (correction !== undefined) {
    // RodzajFaktury + correction metadata precede the monetary aggregates.
    node.RodzajFaktury = FA3_RODZAJ_KOREKTA;
    node.PrzyczynaKorekty = correction.reason;
    node.TypKorekty = correction.typKorekty;
    node.DaneFaKorygowanej = correctedInvoiceNode(correction);
  }
  Object.assign(node, bands);
  node.P_15 = money(grandTotal);
  node.Adnotacje = { OznaczenieNumeruZamowienia: input.orderReference };
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
