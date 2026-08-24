/**
 * Subiekt Line Mapper (#753)
 *
 * Maps neutral `InvoiceLine[]` to bridge-native `BridgeLine[]` (the bridge's
 * `CreateInvoiceLineRequestDto`). The neutral line carries no catalogue symbol,
 * so every line is sent as a one-time line under its `name`:
 *   - `name`           1:1 (the one-time line name; `towarSymbol` is left unset)
 *   - `quantity`       -> `ilosc`
 *   - `unitPriceGross` -> `cenaBrutto`
 *   - `taxRate`        -> `stawkaVAT`
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
import { isTaxRateEnforced } from '@openlinker/core/sales-documents';

/**
 * The Polish standard rate, and the value this mapper substituted for every
 * rate-less line before #2245. Kept - not deleted - because it is still the
 * behaviour with `OL_TAX_RATE_STRICT_ENABLED` off, which is the default while
 * catalogue coverage is being filled in.
 */
const DEFAULT_PL_VAT_RATE = '23';
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
export function toBridgeLines(lines: InvoiceLine[], taxRateEra?: string | null): BridgeLine[] {
  const enforced = isTaxRateEnforced(taxRateEra);
  return lines.map((line) => ({
    name: line.name,
    ilosc: line.quantity,
    cenaBrutto: line.unitPriceGross,
    stawkaVAT: toStawkaVat(line.taxRate, line.name, enforced),
  }));
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
