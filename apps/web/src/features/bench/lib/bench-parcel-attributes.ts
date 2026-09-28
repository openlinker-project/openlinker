/**
 * Which of a variant's attributes are worth putting in front of a packer.
 *
 * The bench shows a variant's attributes under its name so the packer can tell
 * one bottle from another. A real catalogue does not send only the attributes
 * that do that. The demo store's perfume lines each carry
 * `{Wariant: "…50ml", "Reklamowany w TV": "tak", "Kosmetyk ekskluzywny": "tak",
 * "Produkt dla mężczyzn": "tak"}` — of which exactly one differs between the
 * 50ml, 70ml and 100ml rows. Printing all four put three identical lines on
 * every row of the table, pushed each row to four lines tall, and buried the
 * single word that actually picks the right bottle off the shelf.
 *
 * So: when the parcel's lines disagree about an attribute, that attribute is
 * what tells them apart, and it is the only one shown. When nothing
 * disagrees — a one-line parcel, or lines that really are identical — there is
 * nothing to narrow by and everything is shown, because suppressing an
 * attribute nobody can compare would be guessing at which one matters.
 *
 * Deliberately computed in the browser from lines the parcel already holds,
 * not asked of the API: "distinguishing" is a property of THIS box's contents,
 * and the same variant in a different box may need a different answer.
 *
 * @module apps/web/src/features/bench/lib
 */

/** The shape this reads — any parcel line carrying optional attributes. */
export interface AttributeBearingLine {
  readonly attributes: Record<string, string> | null;
}

/** Stands in for "this line does not carry the key at all". */
const ABSENT = Symbol('absent');

/**
 * The keys whose value is not the same on every line.
 *
 * A key one line carries and another does not counts as differing — the
 * presence itself is the distinction.
 */
export function distinguishingAttributeKeys(
  lines: readonly AttributeBearingLine[]
): ReadonlySet<string> {
  if (lines.length < 2) return new Set();

  const keys = new Set<string>();
  for (const line of lines) {
    for (const key of Object.keys(line.attributes ?? {})) keys.add(key);
  }

  const distinguishing = new Set<string>();
  for (const key of keys) {
    const seen = new Set<string | typeof ABSENT>();
    for (const line of lines) {
      const value = line.attributes?.[key];
      seen.add(value === undefined ? ABSENT : value);
    }
    if (seen.size > 1) distinguishing.add(key);
  }
  return distinguishing;
}

/**
 * One line's attributes, narrowed to what tells it apart from its box-mates.
 *
 * Returns `null` rather than an empty object when there is nothing to show, so
 * a caller renders nothing instead of an empty element.
 */
export function narrowAttributes(
  attributes: Record<string, string> | null,
  distinguishing: ReadonlySet<string>
): Record<string, string> | null {
  if (attributes === null || Object.keys(attributes).length === 0) return null;
  // Nothing was found to distinguish by — show what there is.
  if (distinguishing.size === 0) return attributes;

  const narrowed: Record<string, string> = {};
  for (const key of Object.keys(attributes)) {
    if (distinguishing.has(key)) narrowed[key] = attributes[key] ?? '';
  }
  // A line carrying none of the distinguishing keys is the odd one out, and
  // saying nothing about it is worse than saying what it does carry.
  return Object.keys(narrowed).length === 0 ? attributes : narrowed;
}
