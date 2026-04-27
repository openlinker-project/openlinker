/**
 * Sanitize Allegro Name (offer-name and inline-product-name fields)
 *
 * Allegro's `POST /sale/product-offers` rejects offers when
 * `productSet[0].product.name` (the inline-product name we mirror from
 * `body.name`) contains characters its product-name validator considers
 * invalid — confirmed for em-dash (U+2014) by the #419 sandbox repro:
 *
 *     ProductValidationException: Product name contains invalid characters
 *     — - Em Dash [61] (path: productSet[0].product)
 *
 * The product-name validator is stricter than the offer-name validator and
 * almost certainly rejects other Unicode punctuation too — the issue body
 * (#420) enumerates en-dash, curly quotes, and ellipsis as "likely also".
 * This util ASCII-normalizes operator-supplied names before they reach
 * Allegro's wire so the same class of failure cannot re-emerge.
 *
 * Despite the field-specific origin of the bug, this util is named
 * `sanitizeAllegroName` (not `…ProductName`) because the same banned-char
 * set is applied to all three name write sites: offer-section `body.name`
 * on POST, `productSet[0].product.name` on POST (inline product), and
 * `body.name` on PATCH. Two of three are technically offer-name fields,
 * not product-name fields — the neutral name reflects actual scope.
 *
 * Replacement strategy: lossy ASCII normalization (em-dash → ` - `,
 * en-dash → `-`, curly quotes → `'`/`"`, ellipsis → `...`). Idempotent on
 * clean ASCII input. Never throws. Does NOT cap length — the 75-char cap
 * is enforced upstream in the wizard Zod schema and the API DTO; capping
 * here would silently produce mid-word truncations.
 *
 * Future banned chars discovered via sandbox/production rejections are a
 * one-line append to BANNED_NAME_CHAR_MAP — same iterative-discovery loop
 * the description sanitizer follows.
 *
 * @module infrastructure/util
 * @see {@link sanitizeAllegroDescription} for the parallel description sanitizer
 */

/**
 * Banned-character substitution map for Allegro name fields.
 *
 * Keys are Unicode code points Allegro rejects from `body.name` and
 * `productSet[0].product.name`; values are ASCII replacements.
 *
 * The em-dash → ` - ` (space-hyphen-space) mapping is the only multi-char
 * substitution and matches the way Allegro's own userMessage formatter
 * joins fields. The rest are 1:1 substitutions; ellipsis (1 → 3 chars) is
 * the only entry that *expands* the input — at most +2 chars per
 * replacement.
 */
export const BANNED_NAME_CHAR_MAP: Readonly<Record<string, string>> = {
  '—': ' - ', // Em dash → " - " (sandbox-confirmed)
  '–': '-', // En dash → "-"
  '‘': "'", // Left single quotation mark → "'"
  '’': "'", // Right single quotation mark → "'"
  '“': '"', // Left double quotation mark → '"'
  '”': '"', // Right double quotation mark → '"'
  '…': '...', // Horizontal ellipsis → "..."
};

/**
 * Replace banned Unicode punctuation in an Allegro name field with ASCII
 * equivalents, collapse internal whitespace, and trim.
 *
 * - Idempotent on clean ASCII input (round-trips unchanged).
 * - Whitespace collapse covers both substitution-introduced runs (`a — b`
 *   → `a - b`, not `a  -  b`) and pre-existing operator-typed double
 *   spaces. This is a deliberate divergence from `sanitizeAllegroDescription`
 *   which preserves whitespace; for short name fields it's a UX nicety.
 * - Returns the empty string for empty or whitespace-only input.
 */
export function sanitizeAllegroName(name: string): string {
  const substituted = [...name].map((ch) => BANNED_NAME_CHAR_MAP[ch] ?? ch).join('');
  return substituted.replace(/\s+/g, ' ').trim();
}
