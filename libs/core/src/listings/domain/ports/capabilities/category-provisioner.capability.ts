/**
 * Category Provisioner Capability
 *
 * Optional sub-capability of `ShopProductManagerPort` — shop adapters that can
 * mirror a source category path onto the destination (creating missing nodes)
 * declare `implements CategoryProvisioner`. Call sites narrow via
 * `isCategoryProvisioner(adapter)` before invoking `provisionCategory`; after
 * the guard TypeScript knows the method is present.
 *
 * This is ADR-023's placement step #1 made real (ADR-024 §2): only shops can
 * *create* categories — marketplaces map into a fixed tree and never implement
 * this. Distinct from `ProductMasterPort.assignCategories`, which attaches a
 * product to already-existing categories rather than creating the tree.
 *
 * Mirrors the `OfferCreator` precedent (an optional capability guarded against
 * the base `OfferManagerPort`) per engineering-standards §"Port sub-capabilities".
 * The registry capability name is `'CategoryProvisioner'` (#1041) — unlike
 * `OfferCreator`, it is a first-class name in `CoreCapabilityValues` so the
 * ADR-023 resolution brain can resolve it independently and the FE can gate on
 * it.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */

import type {
  ProvisionCategoryCommand,
  ProvisionCategoryResult,
} from '../../types/category-provision.types';
import type { ShopProductManagerPort } from '../shop-product-manager.port';

export interface CategoryProvisioner {
  provisionCategory(cmd: ProvisionCategoryCommand): Promise<ProvisionCategoryResult>;
}

export function isCategoryProvisioner(
  adapter: ShopProductManagerPort,
): adapter is ShopProductManagerPort & CategoryProvisioner {
  return typeof (adapter as Partial<CategoryProvisioner>).provisionCategory === 'function';
}
