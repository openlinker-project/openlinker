/**
 * Product Creator Capability (#3935)
 *
 * Optional sub-capability of `ProductMasterPort`: the master can create a new
 * product from OpenLinker (a bundle product made in OL, then sent on). Declared
 * by the adapter that implements `createProduct` for real; a master that throws
 * NotSupported from it simply does not implement this, so a caller can say so
 * BEFORE an operator fills a form instead of after.
 *
 * Guard-only, like `BundleReader`: absent from every manifest and from
 * `CoreCapabilityValues`, resolved by narrowing an already-dispatched
 * `ProductMaster` adapter with `isProductCreator`.
 *
 * @module libs/core/src/products/domain/ports/capabilities
 */
import type { ProductMasterPort } from '../product-master.port';

/**
 * What the master makes of a new bundle product. `simple-product`: an ordinary
 * product; OpenLinker computes the bundle's stock from its components. (A native
 * pack mode is a later addition and would add a member here.)
 */
export const ProductCreationModeValues = ['simple-product'] as const;
export type ProductCreationMode = (typeof ProductCreationModeValues)[number];

export interface ProductCreator {
  readonly productCreationMode: ProductCreationMode;
}

export function isProductCreator(
  adapter: ProductMasterPort
): adapter is ProductMasterPort & ProductCreator {
  return typeof (adapter as Partial<ProductCreator>).productCreationMode === 'string';
}
