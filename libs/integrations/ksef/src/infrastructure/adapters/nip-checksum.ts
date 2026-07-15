/**
 * Polish NIP checksum (#1595)
 *
 * Pure, static mod-11 check-digit validator for a 10-digit Polish NIP: weight
 * the first 9 digits by `[6,5,7,2,3,4,5,6,7]`, sum the products, take `mod 11`;
 * the result must equal the 10th (check) digit. A remainder of 10 is not a legal
 * check digit, so such a NIP is always rejected. The caller normalises
 * (digits-only) and range-checks the length first; a non-10-digit input returns
 * `false`.
 *
 * Deliberately co-located as a ~10-line local copy rather than shared from
 * `@openlinker/shared`: the provider-agnostic API DTO (`buyer-tax-id.dto.ts`)
 * keeps its own copy so the generic invoicing layer never imports from a
 * concrete provider plugin, and this KSeF-plugin copy keeps the plugin
 * dependency-light. The algorithm is fixed by Polish law and does not drift.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 */
const NIP_CHECKSUM_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];

export function isValidNipChecksum(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  const digits = value.split('').map((c) => Number(c));
  const sum = NIP_CHECKSUM_WEIGHTS.reduce((acc, weight, i) => acc + weight * digits[i], 0);
  const checkDigit = sum % 11;
  if (checkDigit === 10) return false;
  return checkDigit === digits[9];
}
