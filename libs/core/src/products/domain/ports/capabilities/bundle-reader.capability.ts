/**
 * Bundle Reader Capability (#3932, ports-v1 "Optional capabilities")
 *
 * Optional, read-only sub-capability of `ProductMasterPort`: the master states
 * the composition of a product it sells as a bundle (a PrestaShop pack, a
 * Subiekt komplet). A master that can answer declares `implements BundleReader`;
 * one that cannot simply does not.
 *
 * Guard-only, like `ModifiedProductLister`: absent from every manifest and from
 * `CoreCapabilityValues`, resolved by narrowing an already-dispatched
 * `ProductMaster` adapter with `isBundleReader` (a connection's
 * `enabledCapabilities` is stamped at create and never retro-filled, so gating
 * on a new name would silently match no existing connection).
 *
 * The adapter answers in the master's OWN identifiers. Mapping them to OL
 * variants is core's job (identifier mapping), never the adapter's.
 *
 * @module libs/core/src/products/domain/ports/capabilities
 * @see {@link ProductMasterPort} for the base port
 */
import type { ProductMasterPort } from '../product-master.port';

/** One component of a master-side bundle, in the master's own identifiers. */
export interface ExternalBundleComponent {
  /** The component's external product id. */
  externalProductId: string;
  /**
   * The component's external VARIANT id, in the form the adapter's own variant
   * identifier mappings use (the mapping key the master product sync writes), so
   * core can resolve it with `getInternalId('ProductVariant', ...)` unchanged.
   */
  externalVariantId: string;
  /** Units of the component one bundle consumes. Always a positive integer. */
  quantity: number;
}

export interface ExternalBundleComposition {
  components: ExternalBundleComponent[];
}

export interface BundleReader {
  /**
   * Read the composition of the product, or `null` when the master says it is
   * not a bundle. A transport failure propagates unchanged so the caller can
   * retry; `null` is a statement about the product, not about the read.
   */
  readBundleComposition(externalProductId: string): Promise<ExternalBundleComposition | null>;
}

export function isBundleReader(
  adapter: ProductMasterPort
): adapter is ProductMasterPort & BundleReader {
  return typeof (adapter as Partial<BundleReader>).readBundleComposition === 'function';
}
