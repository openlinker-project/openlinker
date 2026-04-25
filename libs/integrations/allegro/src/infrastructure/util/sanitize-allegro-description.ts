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
 * @module infrastructure/util
 * @see https://developer.allegro.pl/documentation — DescriptionSectionItemText
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

export function sanitizeAllegroDescription(html: string): string {
  return html.replace(TAG_PATTERN, (_match, tagName: string) => {
    const lower = tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) {
      return '';
    }
    const isClosing = _match.startsWith('</') || /^<\s*\//.test(_match);
    const isSelfClosing = lower === 'br';
    if (isSelfClosing) {
      return '<br>';
    }
    return isClosing ? `</${lower}>` : `<${lower}>`;
  });
}
