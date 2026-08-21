/**
 * PrestaShop Description Format
 *
 * PrestaShop accepts broad description HTML, so this is a permissive
 * declaration: flat allowlist, no content model, links keep `href`
 * (ADR-046).
 *
 * Provenance is worth stating because it differs from the other adapters.
 * Allegro's format is reconstructed from validator rejections and Erli's is
 * published; this one is inferred from PrestaShop's own OUTPUT. PrestaShop is
 * the ProductMaster whose TinyMCE editor produces the `<div class="rte"
 * style="…">`, `<span style="font-weight:700">` and `<table>` markup that
 * `sanitizeAllegroDescription` existed to strip - a shop that emits those
 * demonstrably stores them. The set below is therefore evidence-based for
 * what it ACCEPTS, and deliberately does not claim to be exhaustive.
 *
 * Erring permissive is the safe direction for a shop: PrestaShop applies its
 * own filtering server-side, so an over-broad declaration loses formatting
 * at the shop, whereas an over-narrow one destroys it here for every store.
 * Narrowing it needs a documented PrestaShop restriction to cite.
 */
import type { DescriptionFormat } from '@openlinker/core/listings';

export const PRESTASHOP_DESCRIPTION_FORMAT: DescriptionFormat = {
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
