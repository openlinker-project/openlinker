/**
 * Tax-Rate Policy
 *
 * Resolves the neutral, pass-through `FiscalTransactionLine.taxRate` onto the
 * single letter a fiscal device in this regime understands.
 *
 * WHY THIS IS A POLICY AND NOT A LOOKUP. The neutral contract says OpenLinker
 * never computes, infers or defaults a rate, and that an empty string means "OL
 * resolved none" rather than "the rate is zero". The vendor, meanwhile, demands
 * BOTH a per-line letter AND a merchant-level letter -> rate table on every
 * document. Bridging the two is regime knowledge, which is why it lives entirely
 * on the adapter side of the boundary.
 *
 * Three inputs are accepted, in order:
 *   1. A bare letter `A`-`G` - passed through verbatim.
 *   2. A rate string (`23`, `23.00`, `23%`, `ZW`) - matched against the
 *      connection's configured table, numerically for percentages so `23` and
 *      `23.00` are the same slot.
 *   3. Empty - resolved to the connection's `defaultTaxRateCode` if, and ONLY
 *      if, the operator declared one. That is the operator naming their own
 *      device slot, not OL inventing a rate.
 *
 * Anything else BLOCKS the registration. Guessing here would transmit a rate the
 * seller never declared onto a fiscal document they are answerable for.
 *
 * **Arm 3 is unreachable while the #2252 gate stands.** Core refuses a sale
 * whose lines do not all name a rate before the adapter is called at all, so an
 * empty `taxRate` no longer arrives here. The arm is kept rather than deleted
 * because it is the shape the behaviour returns to if that gate is reversed -
 * and because deleting it would make the reversal a redesign instead of the one
 * documented branch it is meant to be.
 *
 * Pure - no I/O, no framework.
 *
 * @module libs/integrations/eparagony/src/domain/policies
 */
import {
  EparagonyTaxRateCodeValues,
  type EparagonyTaxRateCode,
  type EparagonyTaxRateTable,
} from '../types/eparagony-config.types';

/**
 * Slot table a Polish online fiscal device ships programmed with today. Applied
 * only when the connection configures none.
 *
 * It describes the SELLER's device, which OL cannot observe - an operator whose
 * device is programmed differently must override it, and the connection config
 * exists for exactly that.
 */
export const EPARAGONY_DEFAULT_TAX_RATES: EparagonyTaxRateTable = {
  A: '23',
  B: '8',
  C: '5',
  D: '0',
  E: 'ZW',
  F: '0',
  G: '0',
};

/** Merge a partial operator override over the default slot table. */
export function resolveTaxRateTable(
  configured?: Partial<EparagonyTaxRateTable>,
): EparagonyTaxRateTable {
  if (!configured) {
    return { ...EPARAGONY_DEFAULT_TAX_RATES };
  }
  const table = { ...EPARAGONY_DEFAULT_TAX_RATES };
  for (const code of EparagonyTaxRateCodeValues) {
    const value = configured[code];
    if (typeof value === 'string' && value.trim().length > 0) {
      table[code] = value.trim();
    }
  }
  return table;
}

/** `null` means the rate is not resolvable and the registration must be blocked. */
export function resolveTaxRateCode(
  neutralRate: string,
  table: EparagonyTaxRateTable,
  fallback?: EparagonyTaxRateCode,
): EparagonyTaxRateCode | null {
  const raw = neutralRate.trim();

  if (raw.length === 0) {
    // OL resolved no rate. Only an operator-declared slot may stand in.
    return fallback ?? null;
  }

  const upper = raw.toUpperCase();
  if (isTaxRateCode(upper) && upper.length === 1) {
    return upper;
  }

  return matchTable(upper, table);
}

/**
 * Match a rate string against the slot table. Exemption markers compare as text;
 * percentages compare numerically so `23`, `23.0` and `23%` are one slot.
 * Ties resolve in `A`..`G` order, which is why the default table's three zero
 * slots settle on `D` - the conventional 0% slot.
 */
function matchTable(rate: string, table: EparagonyTaxRateTable): EparagonyTaxRateCode | null {
  const normalized = rate.replace('%', '').trim();
  const asNumber = Number(normalized);
  const isNumeric = normalized.length > 0 && Number.isFinite(asNumber);

  for (const code of EparagonyTaxRateCodeValues) {
    const slot = table[code].replace('%', '').trim();
    if (slot.toUpperCase() === normalized.toUpperCase()) {
      return code;
    }
    if (isNumeric) {
      const slotNumber = Number(slot);
      if (Number.isFinite(slotNumber) && slotNumber === asNumber) {
        return code;
      }
    }
  }
  return null;
}

export function isTaxRateCode(value: string): value is EparagonyTaxRateCode {
  return (EparagonyTaxRateCodeValues as readonly string[]).includes(value);
}
