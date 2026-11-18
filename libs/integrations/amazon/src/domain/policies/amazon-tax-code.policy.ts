/**
 * Amazon Tax Code Policy (#4182)
 *
 * Amazon carries a product tax CODE (`product_tax_code`, e.g.
 * `A_GEN_STANDARD`, `A_BOOKS_GEN`), never a rate. The operator maps the codes
 * their account uses to rates on the connection (`taxCodeRates`); the
 * catalogue read turns a code into a rate with it, and publishing turns the
 * catalogue rate back into a code with this function.
 *
 * The reverse lookup answers only when it is unambiguous: a rate no code maps
 * to, or one that two codes map to, gives `null` and the listing goes out
 * without a code (Amazon then applies the account default). Guessing between
 * two codes would put a reduced-rate product on the wrong one silently.
 *
 * @module libs/integrations/amazon/src/domain/policies
 */

import type { AmazonTaxCodeResolution } from '../types/amazon-tax-code.types';

export function resolveAmazonTaxCode(
  rate: string | undefined | null,
  taxCodeRates: Readonly<Record<string, string>> | undefined,
): AmazonTaxCodeResolution {
  const wanted = normalizeRate(rate);
  if (wanted === null) {
    return { kind: 'none', reason: 'no-rate' };
  }
  const codes = Object.entries(taxCodeRates ?? {})
    .filter(([, mapped]) => normalizeRate(mapped) === wanted)
    .map(([code]) => code)
    .sort();
  if (codes.length === 0) {
    return { kind: 'none', reason: 'not-mapped' };
  }
  if (codes.length > 1) {
    return { kind: 'none', reason: 'ambiguous', codes };
  }
  return { kind: 'resolved', code: codes[0] };
}

/** `"23"`, `"23.00"` and `" 23 "` are one rate; exemption codes compare as text. */
function normalizeRate(rate: string | undefined | null): string | null {
  const text = rate?.trim().toLowerCase() ?? '';
  if (text.length === 0) {
    return null;
  }
  const number = Number(text);
  return Number.isFinite(number) ? String(number) : text;
}
