/**
 * Modified Product Lister Capability
 *
 * Optional sub-capability of `ProductMasterPort` — the **modified-since rung** of
 * the master capability ladder ([ADR-048](../../../../../../../docs/architecture/adrs/048-incremental-catalog-replication.md)
 * decision 1). A master that can enumerate only the products whose record changed
 * after a caller-supplied watermark declares `implements ModifiedProductLister`;
 * one that cannot simply does not, and stays on the base port's enumerate-only
 * rung — which decision 7 calls correct rather than degraded.
 *
 * Naming: sub-capabilities deliberately drop the `Port` suffix — they layer onto
 * `ProductMasterPort`, they are not independent top-level ports. Do not rename to
 * `ModifiedProductListerPort`. See `listings/domain/ports/capabilities/offer-lister.capability.ts`
 * for the shared convention this directory follows.
 *
 * Guard-only: this name is deliberately NOT in any adapter manifest and NOT in
 * `CoreCapabilityValues`. Call sites resolve it by narrowing an already-dispatched
 * `ProductMaster` adapter with `isModifiedProductLister`, never via
 * `getCapabilityAdapter('ModifiedProductLister')`. The reason is not style: a
 * connection's `enabledCapabilities` is stamped at create from the manifest and is
 * never retro-filled, so *gating* on a newly advertised name would silently drain
 * nothing for every connection that already exists — the shape of the #2085 gap.
 * An advertised name invites exactly that gating, so it is not advertised.
 *
 * @module libs/core/src/products/domain/ports/capabilities
 * @see {@link ProductMasterPort} for the base port
 */
import type { ProductMasterPort } from '../product-master.port';

/**
 * Input for a modified-since enumeration.
 *
 * `limit` and `offset` are REQUIRED, unlike the optional pair on the base port's
 * `listExternalIds`. This rung exists solely to be swept under a budget; leaving
 * the bounds optional would let a caller silently pull the platform's own default
 * page size with no type error.
 */
export interface ListExternalIdsModifiedSinceInput {
  /**
   * Lower bound of the change window, as a UTC instant.
   *
   * A `Date` and never a preformatted string: the platform's wire format and its
   * timezone flag belong to the adapter. WooCommerce must pair `modified_after`
   * with `dates_are_gmt=true` (the default compares against site-local time), and
   * PrestaShop's `date_upd` is written in the shop's own timezone (#2221) — two
   * different answers that core must not attempt to pre-render.
   */
  since: Date;
  /** Maximum ids to return. */
  limit: number;
  /** Zero-based offset into the ordered result set. */
  offset: number;
}

export interface ModifiedProductLister {
  /**
   * List external product ids whose record changed at or after `since`.
   *
   * Returns raw external identifiers, exactly like `ProductMasterPort.listExternalIds`
   * — no identifier mappings are created and no product bodies are fetched. The
   * caller pages until a short page (`< limit`) is returned.
   *
   * The result reports **product-level** freshness only. A platform may not
   * propagate a variant edit to the parent's timestamp (WooCommerce does not —
   * [WC #19562](https://github.com/woocommerce/woocommerce/issues/19562)), and
   * stock is explicitly not on this rung. A caller must not read an empty result
   * as "the catalog is unchanged".
   */
  listExternalIdsModifiedSince(input: ListExternalIdsModifiedSinceInput): Promise<string[]>;
}

export function isModifiedProductLister(
  adapter: ProductMasterPort
): adapter is ProductMasterPort & ModifiedProductLister {
  return (
    typeof (adapter as Partial<ModifiedProductLister>).listExternalIdsModifiedSince === 'function'
  );
}
