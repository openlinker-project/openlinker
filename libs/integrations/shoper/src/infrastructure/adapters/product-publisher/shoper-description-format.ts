/**
 * Shoper Description Format (#3712, ADR-046)
 *
 * What the shop keeps of a product description, measured against a live shop
 * (2026-10-07): Shoper sanitises server-side and keeps rich HTML - headings,
 * lists, tables, `div`/`span` with `class`, `img`, links with `href`/`target`.
 * It strips `script`, the `src` of an `iframe`, `on*` handlers and `javascript:`
 * hrefs, and rewrites `u` / `s` to a styled `span`. No size limit was found.
 *
 * Declared as a flat allowlist with no content model. Being slightly permissive
 * is the safe direction: whatever Shoper dislikes it strips at the shop, whereas
 * an over-narrow declaration would drop formatting here for every shop.
 * `u` and `s` are left out because Shoper turns them into a style attribute the
 * declaration cannot describe.
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters/product-publisher
 */
import type { DescriptionFormat } from '@openlinker/core/listings';

export const SHOPER_DESCRIPTION_FORMAT: DescriptionFormat = {
  shape: 'html',
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr', 'ul', 'ol', 'li',
    'b', 'strong', 'i', 'em', 'sub', 'sup', 'code', 'pre', 'blockquote',
    'a', 'img', 'div', 'span',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'target'],
    img: ['src', 'alt'],
    th: ['colspan'],
    td: ['colspan'],
  },
  contentModel: null,
  rewrites: [],
  maxBytes: null,
};
