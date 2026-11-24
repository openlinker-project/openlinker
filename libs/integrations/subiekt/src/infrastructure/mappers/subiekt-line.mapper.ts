/**
 * Subiekt Line Mapper (#753)
 *
 * Maps neutral `InvoiceLine[]` to bridge-native `BridgeLine[]` (the bridge's
 * `CreateInvoiceLineRequestDto`):
 *   - `name`           1:1 (the printed line name)
 *   - `quantity`       -> `ilosc`
 *   - `unitPriceGross` -> `cenaBrutto`
 *   - `taxRate`        -> `stawkaVAT`
 *   - `productId`      -> `towarSymbol`, via the caller-supplied resolution map
 *
 * THE CATALOGUE SYMBOL IS WHAT MOVES STOCK. Until the neutral line carried a
 * product reference, every line was emitted symbol-less and the bridge routed
 * it to `SuPozycje.DodajUslugeJednorazowa` - a one-time SERVICE line, which
 * Subiekt stores with `ob_TowId = NULL` and which no warehouse document can
 * release. The observable consequence was a seller whose stock never dropped
 * when they sold: the receipt existed, the goods left, and `tw_Stan` stayed
 * where it was, so the next inventory pull republished the already-sold
 * quantity to every other channel. A resolved symbol routes the line to
 * `SuPozycje.Dodaj(symbol)` instead, which is a real catalogue position.
 *
 * A line with NO symbol is still legitimate and still supported - a delivery
 * charge is not a catalogue item - so an unresolved product degrades to the
 * previous service-line behaviour rather than failing the document.
 *
 * THE TAX-REGIME DEFAULT IS ROLLOUT-GATED (#2257, gated in the #2245 review).
 * This mapper substitutes the Polish standard "23" whenever the neutral line
 * carries no rate - which, until a catalogue carries rates, is always. That
 * guess is what #2245 exists to remove: on the issued document a silent 23% is
 * indistinguishable from a confirmed one, and the seller carries the whole cost
 * of it being wrong.
 *
 * So it is removed BY A SWITCH, not by a deploy. With
 * `OL_TAX_RATE_STRICT_ENABLED=true` a rate-less line raises instead; with the
 * switch off (the default) the pre-#2245 default survives, because catalogue
 * coverage is zero on deploy and refusing here would refuse every invoice on
 * day one. See docs/operations/tax-rate-coverage.md for the order the two steps
 * go in.
 *
 * ENFORCEMENT IS PER ORDER, NOT PER DEPLOYMENT (#2260 review). The switch is
 * only half the question: a pre-rollout order is exempt, and core's own guard
 * lets it through. So this mapper takes the order's era and resolves both halves
 * through `isTaxRateEnforced`, exactly as the inFakt and KSeF adapters do -
 * reading the switch alone refused a pre-rollout order on this route while the
 * same order issued on the other two. Past that, core has already refused any
 * command this guard would refuse, so it is defence in depth. The Subiekt bridge
 * would reject the line anyway ("StawkaVAT jest wymagana"); the difference is
 * that the failure names the product rather than a bridge field. The bridge parses Polish rate
 * symbols ("23","8","5","0","zw","np") in percent-as-string notation (#2247),
 * and a rate the source supplied passes through verbatim.
 *
 * @module libs/integrations/subiekt/src/infrastructure/mappers
 */
import type { CorrectionLine, InvoiceLine } from '@openlinker/core/invoicing';
import { MissingTaxRateException, assertPercentTaxRateNotation } from '@openlinker/core/invoicing';
import { isTaxRateEnforced, minorUnitExponentFor } from '@openlinker/core/sales-documents';

/**
 * The Polish standard rate, and the value this mapper substituted for every
 * rate-less line before #2245. Kept - not deleted - because it is still the
 * behaviour with `OL_TAX_RATE_STRICT_ENABLED` off, which is the default while
 * catalogue coverage is being filled in.
 */
const DEFAULT_PL_VAT_RATE = '23';
import { SubiektInvoiceRejectedError } from '../../domain/exceptions/subiekt-invoice-rejected.exception';
import type { BridgeKorektaLine, BridgeLine } from '../../bridge/subiekt-bridge.types';

/**
 * The bridge parses the neutral code as a Polish rate symbol, so it is passed
 * through verbatim - but the notation is still part of the contract (#2247).
 * `assertPercentTaxRateNotation` rejects a fractional spelling rather than
 * letting `'0.23'` reach Subiekt, where it is neither a known symbol nor a rate
 * anyone declared.
 *
 * An empty code raises when enforcement applies to this order (#2257) and
 * otherwise resolves to {@link DEFAULT_PL_VAT_RATE}, which is what every
 * document issued through this bridge before #2245 carried.
 */
function toStawkaVat(taxRate: string, lineName: string, enforced: boolean): string {
  const code = assertPercentTaxRateNotation(taxRate);
  if (code.length === 0) {
    if (!enforced) {
      return DEFAULT_PL_VAT_RATE;
    }
    throw new MissingTaxRateException(lineName, {
      lineCount: 1,
      totalLines: 1,
      firstLineRef: lineName,
    });
  }
  return code;
}

/**
 * Map the neutral lines onto the bridge shape.
 *
 * `taxRateEra` is the order's own marker (`IssueInvoiceCommand.taxRateEra`) and
 * is what makes this route agree with inFakt and KSeF for the same order: it is
 * resolved ONCE here, so a pre-rollout order keeps the pre-#2245 default even
 * with the switch on. Omitting it means "not pre-rollout", the ordinary case.
 */
export function toBridgeLines(
  lines: InvoiceLine[],
  taxRateEra?: string | null,
  symbolByProductId?: ReadonlyMap<string, string>,
): BridgeLine[] {
  const enforced = isTaxRateEnforced(taxRateEra);
  return lines.map((line) => {
    // A resolved symbol makes this a real catalogue line on the document
    // (`d.Pozycje.Dodaj(symbol)` bridge-side), which is what actually moves
    // stock; without one the bridge falls back to `DodajUslugeJednorazowa` and
    // the line is a one-time service that the warehouse never sees. A shipping
    // charge legitimately has no product and stays a service line.
    // Keyed by the line's own catalogue key - the VARIANT when it has one.
    // Two members of one Subiekt model share a `productId` and are different
    // towary, so a product-keyed lookup would give them both the same symbol.
    const towarSymbol =
      line.productId !== undefined
        ? symbolByProductId?.get(line.variantId ?? line.productId)
        : undefined;
    return {
      name: line.name,
      ilosc: line.quantity,
      cenaBrutto: line.unitPriceGross,
      stawkaVAT: toStawkaVat(line.taxRate, line.name, enforced),
      ...(towarSymbol !== undefined && towarSymbol !== '' ? { towarSymbol } : {}),
    };
  });
}

/**
 * Map a neutral `CorrectionLine` to the bridge-native korekta line. Only the
 * fields the caller actually changed are emitted (`nowaIlosc` / `nowaCena`), so an
 * absent field on the wire means "unchanged". `newUnitPriceGross` is a GROSS unit
 * price -> `nowaCena`.
 */
export function toBridgeKorektaLine(line: CorrectionLine): BridgeKorektaLine {
  return {
    lp: line.originalLineNumber,
    ...(line.newQuantity != null ? { nowaIlosc: line.newQuantity } : {}),
    ...(line.newUnitPriceGross != null ? { nowaCena: line.newUnitPriceGross } : {}),
  };
}

/**
 * Last-resort division of a paid total over parts by unit count, for a request
 * from a core that did not send its own shares. The single implementation both
 * Subiekt adapters fall back to; the remainder lands on the last part so the
 * parts add up to exactly the total.
 */
export function splitTotalByUnits(
  total: number,
  quantities: readonly number[],
  currency?: string | null,
): number[] {
  const factor = 10 ** minorUnitExponentFor(currency);
  const round = (value: number): number => Math.round(value * factor) / factor;
  const units = quantities.reduce((sum, q) => sum + q, 0);
  if (units <= 0) {
    return quantities.map(() => 0);
  }
  let allocated = 0;
  return quantities.map((q, i) => {
    const share = i === quantities.length - 1 ? round(total - allocated) : round((total * q) / units);
    allocated += share;
    return share;
  });
}

/**
 * Sell the physical components of a bundle line instead of the bundle (#3607).
 *
 * Subiekt's document moves stock, and a set's own towar has none, so a line
 * that carries `stockComponents` is replaced by one line per component, in the
 * component order. Each component's value is the share OpenLinker's core split
 * out of the paid set total (`totalGross`); only a component list without those
 * shares - an older core - falls back to dividing the total by unit count.
 */
export function expandStockComponents(
  lines: readonly InvoiceLine[],
  currency?: string | null,
): InvoiceLine[] {
  const factor = 10 ** minorUnitExponentFor(currency);
  const round = (value: number): number => Math.round(value * factor) / factor;
  const out: InvoiceLine[] = [];
  for (const line of lines) {
    const components = line.stockComponents;
    if (components === undefined || components.length === 0) {
      out.push(line);
      continue;
    }
    const total = round(line.unitPriceGross * line.quantity);
    const paid = components.filter((c) => c.giftSlot !== true);
    const coreShares = paid.every((c) => typeof c.totalGross === 'number');
    const fallback = coreShares
      ? []
      : splitTotalByUnits(total, paid.map((c) => c.quantity), currency);
    let paidIndex = 0;
    for (const component of components) {
      const isGift = component.giftSlot === true;
      let share = 0;
      if (!isGift) {
        share = coreShares ? (component.totalGross ?? 0) : fallback[paidIndex];
        paidIndex += 1;
      }
      // A component line must not carry the set's own expansion on to the document.
      const rest: InvoiceLine = { ...line, stockComponents: undefined };
      out.push({
        ...rest,
        name: component.name?.trim() || line.name,
        quantity: component.quantity,
        unitPriceGross: component.quantity > 0 ? Math.round((share / component.quantity) * 10000) / 10000 : 0,
        productId: component.productId,
        variantId: component.variantId,
      });
    }
  }
  return out;
}

/**
 * Re-address a correction to the document Subiekt actually holds.
 *
 * Core numbers `originalLineNumber` against the issued snapshot, where a set is
 * ONE line, while `expandStockComponents` put one document position per
 * component in its place - so every position after a set shifts, and the set's
 * own number now names a component. This maps each snapshot position onto the
 * expanded one(s) and scales a quantity change over the components. A price
 * change on a set line cannot be carried (the component prices are shares of
 * one total) and is refused rather than written to a guessed position.
 */
export function remapCorrectionLinesToExpandedDocument(
  corrections: readonly CorrectionLine[],
  snapshotLines: readonly InvoiceLine[] | undefined,
): CorrectionLine[] {
  if (snapshotLines === undefined || snapshotLines.every((l) => !l.stockComponents?.length)) {
    return [...corrections];
  }
  const startByIndex: number[] = [];
  let next = 1;
  for (const line of snapshotLines) {
    startByIndex.push(next);
    next += line.stockComponents?.length ? line.stockComponents.length : 1;
  }
  const out: CorrectionLine[] = [];
  for (const correction of corrections) {
    const index = correction.originalLineNumber - 1;
    const line = snapshotLines[index];
    if (line === undefined) {
      out.push(correction);
      continue;
    }
    const components = line.stockComponents;
    if (components === undefined || components.length === 0) {
      out.push({ ...correction, originalLineNumber: startByIndex[index] });
      continue;
    }
    if (correction.newUnitPriceGross != null) {
      throw new SubiektInvoiceRejectedError(
        `Line ${correction.originalLineNumber} is a set sold as its components; a price correction cannot be split over them. Correct the quantity, or issue the correction by hand in Subiekt.`,
      );
    }
    components.forEach((component, offset) => {
      const scaled =
        correction.newQuantity == null || !(line.quantity > 0)
          ? undefined
          : Math.round((component.quantity * correction.newQuantity) / line.quantity);
      out.push({
        ...correction,
        originalLineNumber: startByIndex[index] + offset,
        ...(scaled !== undefined ? { newQuantity: scaled } : {}),
      });
    });
  }
  return out;
}
