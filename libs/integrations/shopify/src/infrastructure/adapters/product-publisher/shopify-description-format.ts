/**
 * Shopify Description Format (#3979, ADR-046)
 *
 * What OpenLinker sends as a Shopify product's `descriptionHtml`. Shopify keeps
 * the HTML byte for byte and sanitises nothing (SPIKE-2879 E-P2, a literal
 * `<script>` round-tripped), so this declaration is the whole of the shaping a
 * description gets: a permissive allowlist of the rich-text tags a storefront
 * theme renders, links and images included. No content model; the byte cap is
 * a generous guard, not a Shopify limit (none was found).
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/product-publisher
 */
import type { DescriptionFormat } from '@openlinker/core/listings';

export const SHOPIFY_DESCRIPTION_FORMAT: DescriptionFormat = {
  shape: 'html',
  allowedTags: [
    'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li',
    'h2', 'h3', 'h4', 'a', 'img', 'blockquote',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['href'],
    img: ['src', 'alt'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  contentModel: null,
  rewrites: [],
  maxBytes: 512_000,
};
