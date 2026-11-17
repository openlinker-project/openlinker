/**
 * PrestaShop name sanitizer
 *
 * PrestaShop validates customer and address first/last names with
 * `Validate::isName`, which refuses digits and the characters
 * ! < > , ; ? = + ( ) @ # " ° { } _ $ % : ¤ |. A buyer name carrying any of
 * them (a company name, a marketplace placeholder such as "c12-pay") makes the
 * webservice answer 400 and the order is never created. Assumption: this is the
 * 1.7/8 `isName` pattern; the sanitizer additionally drops `* ^ ~ [ ] \ /` as a
 * conservative margin and caps the length at the 255-char column width.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */

const ISNAME_FORBIDDEN = /[0-9!<>,;?=+()@#"°{}_$%:¤|*^~[\]\\/]/gu;
const GENERIC_NAME_FORBIDDEN = /[<>;=#{}]/gu;
const MAX_NAME_LENGTH = 255;

export interface SanitizedPrestashopName {
  value: string;
  /** True when the input was non-empty and had to be altered. */
  changed: boolean;
}

/**
 * Reduce a buyer name to what `isName` accepts, falling back to `fallback`
 * when nothing usable is left.
 */
export function sanitizePrestashopName(
  raw: string | null | undefined,
  fallback: string
): SanitizedPrestashopName {
  const input = (raw ?? '').trim();
  if (input.length === 0) {
    return { value: fallback, changed: false };
  }
  const cleaned = input
    .replace(ISNAME_FORBIDDEN, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  if (cleaned.length === 0) {
    return { value: fallback, changed: true };
  }
  return { value: cleaned, changed: cleaned !== input };
}

/**
 * Render original buyer name parts for the address `company` field, which
 * accepts a generic name (no < > ; = # { }).
 */
export function toPrestashopCompanyNote(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0)
    .join(' ')
    .replace(GENERIC_NAME_FORBIDDEN, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}
