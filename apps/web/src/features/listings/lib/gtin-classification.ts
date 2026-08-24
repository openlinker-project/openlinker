/**
 * GTIN classification (#2243)
 *
 * Pure barcode classification for the Review step. The wizard already rejects a
 * bad GS1 check digit (`isValidGtin` in `bulk-policy.ts`); this module answers
 * the two questions that came after it, both of which Allegro answers with the
 * same rejection today:
 *
 *  - **is this a trade item number at all?** Restricted-circulation prefixes
 *    (`02x`, `04x`, `2xx`) and the coupon block (`98x`, `99x`) are assigned
 *    INSIDE a retailer and never registered with GS1, so they cannot resolve to
 *    a catalogue product no matter how the check digit comes out. This is the
 *    single most common junk barcode in a shop catalogue.
 *  - **is a catalogue miss meaningful?** No - only suggestive. A brand-new,
 *    perfectly licensed GTIN has no Allegro card yet either. So an unmatched
 *    barcode can only ever WARN; claiming it is invalid would be a false
 *    statement about the operator's own data.
 *
 * The carve-out matters as much as the rule: `977` (ISSN), `978` / `979` (ISBN,
 * ISMN) are legitimate GTINs for books, magazines and sheet music. Flagging them
 * would break an entire vertical, so they are explicitly excluded.
 *
 * @module apps/web/src/features/listings/lib
 */

/** Restricted-circulation / coupon prefixes, per GS1's general specification. */
const RESTRICTED_CIRCULATION = /^(02\d|04\d|9[89]\d)/;
/** Publication prefixes that ARE valid trade item numbers - never flag these. */
const PUBLICATION_PREFIXES = /^(977|978|979)/;

/**
 * True when the barcode's prefix marks it as an in-store or coupon code rather
 * than a GS1-licensed trade item number. Only meaningful for EAN-13 - a GTIN-8
 * or UPC-A carries no such prefix block that we can read reliably.
 */
export function isRestrictedCirculationGtin(code: string): boolean {
  const trimmed = code.trim();
  if (!/^\d{13}$/.test(trimmed)) return false;
  if (PUBLICATION_PREFIXES.test(trimmed)) return false;
  if (RESTRICTED_CIRCULATION.test(trimmed)) return true;
  const prefix = Number(trimmed.slice(0, 3));
  return prefix >= 200 && prefix <= 299;
}
