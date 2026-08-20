/**
 * WooCommerce Description Format
 *
 * WooCommerce stores description HTML broadly, so this is the permissive end
 * of the range: a flat allowlist, no content model, links keep `href`
 * (ADR-046).
 *
 * The real allowlist is WordPress's own `wp_kses`, which varies with the API
 * user's role and the store's configuration - a shop can be more or less
 * permissive than this declaration. That per-CONNECTION variance is exactly
 * why the declaration is a capability method rather than a static manifest
 * entry: deriving it from the connection is possible here later, and would
 * not be from a manifest.
 *
 * Being permissive is safe in the direction that matters: WordPress strips
 * what it dislikes server-side, so an over-broad declaration loses
 * formatting silently at the shop, whereas an over-narrow one would lose it
 * here for every store including those that accept more.
 */
import type { DescriptionFormat } from '@openlinker/core/listings';

export const WOOCOMMERCE_DESCRIPTION_FORMAT: DescriptionFormat = {
  shape: 'html',
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'p', 'br', 'ul', 'ol', 'li',
    'b', 'strong', 'i', 'em', 'u', 's', 'a', 'blockquote',
  ],
  allowedAttributes: { a: ['href'] },
  contentModel: null,
  rewrites: [],
  maxBytes: 65_536,
};
