/**
 * Mask a person's name (#3425; extracted and shared by #3415, mockup-parity
 * epic #3401)
 *
 * ONE rule for reducing a person's name to something recognisable but not
 * fully identifying, with two readers: the Assign Packing Work board's buyer
 * name (`readMaskedBuyerName`) and the pack bench's "someone else has this
 * parcel open too" collision banner (`BenchPresenceService`).
 *
 * It lives here, shared, rather than being copied into the second reader,
 * because two masking rules for one concept is drift by construction — and a
 * masking rule that drifts discloses more on one surface than the product
 * decided to disclose on the other. A second copy would be the thing the
 * repository's `check-*-mirror.mjs` scripts exist to prevent, without even
 * the mirror check.
 *
 * Pure: no I/O, no clock, no injected dependency.
 *
 * @module apps/api/src/common/format
 */

/**
 * Mask a full name to its FIRST INITIAL plus surname — "Anna Kowalska"
 * becomes "A. Kowalska".
 *
 * A single-word name is returned UNMASKED — there is no surname to keep and
 * no first name to reduce to an initial, so masking it further would destroy
 * the only identifying fact rather than merely reduce it. That case is a
 * company, a source that reported the name as one field, or (on the bench)
 * an account whose username is a single token such as `admin`.
 */
export function maskName(name: string): string {
  const parts = name.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length < 2) return name;
  const [first, ...rest] = parts;
  return `${first.charAt(0)}. ${rest.join(' ')}`;
}
