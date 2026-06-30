/**
 * FA(3) Tax-Rate Mapper (neutral `taxRate` → `P_12`)
 *
 * Pure, total mapping from the neutral `InvoiceLine.taxRate` string code onto
 * the FA(3) `P_12` enum. This is the single place the PL tax vocabulary is
 * derived from the country-agnostic core code (ADR-026). Unknown codes throw
 * `UnmappedTaxRateException` — never a silent default — so a mis-keyed rate
 * surfaces loudly at build time rather than emitting a wrong fiscal value.
 *
 * `FA3_TAX_RATE_MAP` is the working mapping table covering all 10 `P_12` values.
 * The canonical neutral tax-rate code set (UNCL 5305 vs OpenLinker-custom) is
 * still being settled upstream; the keys below are the provisional contract
 * documented in FA3_IMPLEMENTATION_NOTES.md and MUST be reconciled before C3
 * submission.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/domain
 */
import { UnmappedTaxRateException } from '../../../domain/exceptions/fa3-builder.exception';
import type { Fa3P12Value } from './fa3-schema.types';

/**
 * Neutral tax-rate code → FA(3) `P_12`. Covers every one of the 10 `P_12`
 * values. Both the bare-percent forms (`23`) and the explicit zero-rate /
 * special-regime codes are accepted.
 */
export const FA3_TAX_RATE_MAP: Readonly<Record<string, Fa3P12Value>> = {
  '23': '23',
  '8': '8',
  '5': '5',
  '0-kr': '0 KR',
  '0-wdt': '0 WDT',
  '0-ex': '0 EX',
  exempt: 'zw',
  zw: 'zw',
  'reverse-charge': 'oo',
  oo: 'oo',
  // KSeF has no bare `np` — "not applicable / outside scope" is two distinct
  // tokens: `np I` (general supply outside PL territory → P_13_8) and `np II`
  // (art. 100(1)(4) services taxed in the buyer's EU state → P_13_9).
  'np-i': 'np I',
  'np-ii': 'np II',
};

/**
 * Resolve a neutral tax-rate code to its FA(3) `P_12` value.
 *
 * @throws {UnmappedTaxRateException} when the code is unknown / empty.
 */
export function resolveP12(neutralTaxRate: string): Fa3P12Value {
  const mapped = FA3_TAX_RATE_MAP[neutralTaxRate];
  if (mapped === undefined) {
    throw new UnmappedTaxRateException(neutralTaxRate);
  }
  return mapped;
}
