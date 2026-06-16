/**
 * Shop Product Manager Port
 *
 * Canonical capability contract for **shop** product listing/publishing — the
 * structural sibling of `OfferManagerPort` on the shop side of ADR-024. Where a
 * marketplace adapter lists a thin offer over a catalog card (`OfferManagerPort`
 * + `OfferCreator`, …), a shop adapter creates/owns the product record itself
 * (content, images, SEO, multi-category placement, price/stock as fields,
 * draft/published visibility).
 *
 * Like `OfferManagerPort`, the base port carries only the one method every
 * shop-listing adapter must implement: `publishProduct`. Additional shop
 * behaviours (category provisioning today; unpublish / set-visibility /
 * status-read as the surface grows) live as distinct capability interfaces
 * under `./capabilities/`, declared via `implements` and narrowed at call sites
 * with the co-located `is{Capability}` guards (e.g. `isCategoryProvisioner`).
 *
 * Capability name ↔ interface skew (documented once, here): the registry
 * capability name for this port is **`'ProductPublisher'`** (what an adapter
 * declares in `supportedCapabilities`, what `enabledCapabilities` carries, and
 * what the FE CTA gates on — #1041/#1044), resolved as
 * `getCapabilityAdapter<ShopProductManagerPort>(connectionId, 'ProductPublisher')`.
 * The interface is named `ShopProductManagerPort` (the umbrella that accretes
 * sub-capabilities) rather than `ProductPublisherPort`. This is the one place a
 * core capability name diverges from its backing interface name; every other
 * core capability is name-aligned.
 *
 * Domain-only: no framework dependencies.
 *
 * @module libs/core/src/listings/domain/ports
 * @see {@link CategoryProvisioner} for the first sub-capability.
 */

import type {
  PublishProductCommand,
  PublishProductResult,
} from '../types/product-publish.types';

export interface ShopProductManagerPort {
  /**
   * Create-or-upsert a product record on the shop destination. Throws
   * `ProductPublishRejectedException` when the shop rejects the publish and no
   * record was created/updated; a non-throwing result means the
   * `externalProductId` exists on the shop.
   */
  publishProduct(cmd: PublishProductCommand): Promise<PublishProductResult>;
}
