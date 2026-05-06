/**
 * Sanitize Allegro Description
 *
 * Allegro's `POST /sale/product-offers` rejects `description.sections[].items[].content`
 * (TEXT type) when it contains attributes (`style`, `class`, …) or tags outside its
 * narrow whitelist. PrestaShop product descriptions arrive with inline TinyMCE styling
 * that violates both rules, so we strip attributes and filter tags to Allegro's
 * accepted set before sending. Inner text from disallowed tags is preserved so the
 * description stays readable.
 *
 * The current input surface is exclusively well-formed HTML produced by PrestaShop's
 * TinyMCE editor, which keeps the regex-based transformation tractable. If this utility
 * ever ingests user-controlled HTML (e.g. an in-app description editor) swap to a
 * real allowlist parser like `sanitize-html`.
 *
 * Allegro caps the field at 40000 bytes; we truncate at the last closing-tag boundary
 * before the cap so we never push a payload that would 422 on length.
 *
 * Block-wrap contract (#540): Allegro's TEXT validator further requires the content
 * to open with a block-level tag (`<p>`, `<h1>`, `<h2>`, `<ul>`, `<ol>`). Plain text
 * and inline-only output (e.g. `<b>bold</b>`) get wrapped in `<p>…</p>` so AI-generated
 * descriptions, CSV imports, or simple operator copy don't fail with
 * `VALIDATION_ERROR / "Nieprawidłowy podzbiór HTML"`. Empty and whitespace-only inputs
 * collapse to `''` — both call sites (offer create, field update) treat empty content
 * as "no description", so the contract stays symmetric with the existing empty-input
 * case and avoids ever shipping bare whitespace to Allegro.
 *
 * @module infrastructure/util
 * @see https://developer.allegro.pl/documentation — DescriptionSectionItemText, StandardizedDescription
 */

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'h1',
  'h2',
  'ul',
  'ol',
  'li',
  'b',
  'strong',
  'i',
  'em',
  'u',
]);

const TAG_PATTERN = /<\s*\/?\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;

// Block-level tags Allegro's TEXT validator accepts as the leading element.
// `<li>` and `<br>` are deliberately excluded — `<li>` outside `<ul>`/`<ol>` is
// malformed regardless of Allegro, and a bare `<br>` doesn't satisfy the
// "must open with a block tag" rule (an input of just `<br>` ends up wrapped
// as `<p><br></p>`, which Allegro accepts).
const BLOCK_TAG_OPENER_PATTERN = /<(p|h1|h2|ul|ol)\b/i;

const WRAPPER_PREFIX = '<p>';
const WRAPPER_SUFFIX = '</p>';
const WRAPPER_OVERHEAD = Buffer.byteLength(WRAPPER_PREFIX + WRAPPER_SUFFIX, 'utf8');

const MAX_BYTES = 40000;

export function sanitizeAllegroDescription(html: string): string {
  const stripped = html.replace(TAG_PATTERN, (match, tagName: string) => {
    const lower = tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) {
      return '';
    }
    if (lower === 'br') {
      return '<br>';
    }
    const isClosing = /^<\s*\//.test(match);
    return isClosing ? `</${lower}>` : `<${lower}>`;
  });

  // Empty/whitespace-only contract: collapse to `''` so callers (notably
  // `updateOfferFields`, which has no `.trim()` gate at the call site) never
  // ship bare whitespace to Allegro.
  if (stripped.trim().length === 0) {
    return '';
  }

  const wrap = !BLOCK_TAG_OPENER_PATTERN.test(stripped);
  const budget = wrap ? MAX_BYTES - WRAPPER_OVERHEAD : MAX_BYTES;
  const capped = capByteLength(stripped, budget);
  return wrap ? `${WRAPPER_PREFIX}${capped}${WRAPPER_SUFFIX}` : capped;
}

function capByteLength(html: string, maxBytes: number): string {
  if (Buffer.byteLength(html, 'utf8') <= maxBytes) {
    return html;
  }
  let bytes = 0;
  let cutAt = 0;
  for (let i = 0; i < html.length; i++) {
    const charBytes = Buffer.byteLength(html[i], 'utf8');
    if (bytes + charBytes > maxBytes) break;
    bytes += charBytes;
    cutAt = i + 1;
  }
  // Cut at the last '>' inside the budget so we never leave a half-open tag on
  // the wire. Falls back to the raw byte cut if the cut window contains no tag
  // (e.g. plain-text descriptions over the cap).
  const lastGt = html.lastIndexOf('>', cutAt - 1);
  return lastGt >= 0 ? html.slice(0, lastGt + 1) : html.slice(0, cutAt);
}
