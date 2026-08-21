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
 * NO TAX-REGIME DEFAULT (#2257). This mapper used to substitute the Polish
 * standard "23" whenever the neutral line carried no rate - which was always,
 * because core had no per-line rate to give. That guess is what #2245 removes:
 * on the issued document a silent 23% is indistinguishable from a confirmed
 * one, and the seller carries the whole cost of it being wrong.
 *
 * Core now refuses a rate-less command before any adapter runs, so the guard
 * here is defence in depth. The Subiekt bridge would reject the line anyway
 * ("StawkaVAT jest wymagana"); the difference is that the failure now names the
 * product rather than a bridge field. The bridge parses Polish rate symbols
 * ("23","8","5","0","zw","np") in percent-as-string notation (#2247), and a
 * rate the source supplied passes through verbatim.
 *
 * @module libs/integrations/subiekt/src/infrastructure/mappers
 */
import type { CorrectionLine, InvoiceLine } from '@openlinker/core/invoicing';
import { MissingTaxRateException, assertPercentTaxRateNotation } from '@openlinker/core/invoicing';
import type { BridgeKorektaLine, BridgeLine } from '../../bridge/subiekt-bridge.types';

/**
 * The bridge parses the neutral code as a Polish rate symbol, so it is passed
 * through verbatim - but the notation is still part of the contract (#2247).
 * `assertPercentTaxRateNotation` rejects a fractional spelling rather than
 * letting `'0.23'` reach Subiekt, where it is neither a known symbol nor a rate
 * anyone declared.
 *
 * An empty code now raises (#2257) instead of resolving to "23". Nothing here
 * is allowed to invent a rate for a fiscal document.
 */
function toStawkaVat(taxRate: string, lineName: string): string {
  const code = assertPercentTaxRateNotation(taxRate);
  if (code.length === 0) {
    throw new MissingTaxRateException(lineName, {
      lineCount: 1,
      totalLines: 1,
      firstProductId: lineName,
    });
  }
  return code;
}

export function toBridgeLines(lines: InvoiceLine[]): BridgeLine[] {
  return lines.map((line) => ({
    name: line.name,
    ilosc: line.quantity,
    cenaBrutto: line.unitPriceGross,
    stawkaVAT: toStawkaVat(line.taxRate, line.name),
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
