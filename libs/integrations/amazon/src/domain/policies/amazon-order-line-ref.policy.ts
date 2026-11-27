/**
 * Amazon Order Line Reference Policy
 *
 * Which identifier mapping an Amazon order line is resolved through. An
 * Amazon line names the seller SKU, and OpenLinker records that SKU under one
 * of two entity types depending on the connection's role:
 *
 *   - `variant`: the connection is the catalogue (`ProductMaster`); the
 *     catalogue sync mints a `ProductVariant` mapping keyed by the SKU of each
 *     listing.
 *   - `offer`: the catalogue lives elsewhere and Amazon carries offers; the
 *     offer sync and offer creation record an `Offer` mapping keyed by the SKU,
 *     the same way an Allegro or Erli line is resolved.
 *
 * A `sku` reference is never used: nothing records a `Sku` mapping, so a line
 * keyed that way stays unresolved for ever.
 *
 * @module libs/integrations/amazon/src/domain/policies
 */

export const AmazonOrderLineRefValues = ['variant', 'offer'] as const;
export type AmazonOrderLineRef = (typeof AmazonOrderLineRefValues)[number];

export function resolveAmazonOrderLineRef(enabledCapabilities: readonly string[]): AmazonOrderLineRef {
  return enabledCapabilities.includes('ProductMaster') ? 'variant' : 'offer';
}
