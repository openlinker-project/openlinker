/**
 * KSeF NIP normalization + checksum
 *
 * Single source of truth for stripping the dashes/spaces an operator may paste
 * into a Polish NIP field. Both the create-path (`ksef-setup.schema.ts`) and the
 * edit-path (`ksef-connection-config.ts` zod transform + assembly)
 * call this so the persisted `config.seller.nip` shape (digits only) can't drift
 * between the two flows.
 *
 * @module plugins/ksef/lib
 */
export function normalizeNip(value: string): string {
  return value.replace(/[\s-]/g, '');
}

/**
 * Validates the Polish NIP mod-11 check digit (#1595).
 *
 * The published algorithm: weight the first 9 digits by
 * `[6,5,7,2,3,4,5,6,7]`, sum the products, take `mod 11`; the result must
 * equal the 10th (check) digit. A remainder of 10 is not a legal check digit,
 * so such a NIP is always rejected. The input must already be 10 digits
 * (normalise + `^\d{10}$`-check first); a non-conforming input returns `false`.
 *
 * Pure, static, dependency-free. Co-located here (the FE NIP-util home) rather
 * than in `@openlinker/shared`: the FE bundle does not consume that package, and
 * the two backend layers keep their own ~10-line copies to avoid coupling the
 * provider-agnostic invoicing API and the KSeF plugin through a shared runtime.
 */
export function isValidNipChecksum(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const digits = value.split('').map((c) => Number(c));
  const sum = weights.reduce((acc, weight, i) => acc + weight * digits[i], 0);
  const checkDigit = sum % 11;
  if (checkDigit === 10) return false;
  return checkDigit === digits[9];
}
