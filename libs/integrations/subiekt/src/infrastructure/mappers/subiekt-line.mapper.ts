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
 * TAX-REGIME DEFAULT (Subiekt-specific): the neutral core `InvoiceLine` leaves
 * `taxRate` empty by design — core never names a tax rate on the order contract
 * ("the provider adapter resolves the regime rate", see the core line mapper).
 * The Subiekt bridge REQUIRES a non-empty `stawkaVAT` ("StawkaVAT jest wymagana")
 * and parses Polish rate symbols ("23","8","5","0","zw","np"). When the neutral
 * line carries no rate we therefore default to the Polish standard rate "23".
 * A rate the source DID supply passes through verbatim.
 *
 * @module libs/integrations/subiekt/src/infrastructure/mappers
 */
import type { CorrectionLine, InvoiceLine } from '@openlinker/core/invoicing';
import type { BridgeKorektaLine, BridgeLine } from '../../bridge/subiekt-bridge.types';

/** Polish standard VAT rate — used when the neutral line carries no rate. */
const DEFAULT_PL_VAT_RATE = '23';

export function toBridgeLines(lines: InvoiceLine[]): BridgeLine[] {
  return lines.map((line) => ({
    name: line.name,
    ilosc: line.quantity,
    cenaBrutto: line.unitPriceGross,
    stawkaVAT: line.taxRate.trim().length > 0 ? line.taxRate.trim() : DEFAULT_PL_VAT_RATE,
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
