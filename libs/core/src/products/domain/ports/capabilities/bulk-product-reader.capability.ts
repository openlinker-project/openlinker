/**
 * Bulk Product Reader Capability
 *
 * Optional sub-capability of `ProductMasterPort` — the **bulk-read rung** of the
 * master capability ladder ([ADR-048](../../../../../../../docs/architecture/adrs/048-incremental-catalog-replication.md)
 * decision 1). A master that can hydrate MANY products in a handful of requests
 * declares `implements BulkProductReader`; one that can only serve a product at a
 * time simply does not, and the per-product path it already has stays correct.
 *
 * The rung is a PREFETCH, not a second sync path. It is deliberately shaped as a
 * void-returning warm-up rather than "return me N products", because the whole
 * per-product pipeline behind `syncFromMasterByExternalId` — identifier mapping,
 * variant resolution, the tax-rate journal, the #1904 rival-claimant prune guard,
 * the #1599 deletion signal — has to keep running exactly as it does today. A
 * second path returning hydrated products would have to re-implement all of it,
 * and every guard re-implemented is a guard that can drift. So the caller warms
 * the adapter and then runs the unchanged loop.
 *
 * That makes one property load-bearing: the prefetch must be **invisible except
 * in request count**. Nothing may behave differently because it ran, and a
 * failure must degrade to the per-product reads rather than fail the batch.
 *
 * Naming: sub-capabilities drop the `Port` suffix — they layer onto
 * `ProductMasterPort`, they are not independent top-level ports.
 *
 * Guard-only: this name is deliberately NOT in any adapter manifest and NOT in
 * `CoreCapabilityValues`, for the reason `modified-product-lister.capability.ts`
 * states at length — a connection's `enabledCapabilities` is stamped at create
 * and never retro-filled, so gating on a newly advertised name would drain
 * nothing for every connection that already exists.
 *
 * @module libs/core/src/products/domain/ports/capabilities
 * @see {@link ProductMasterPort} for the base port
 */
import type { ProductMasterPort } from '../product-master.port';

export interface BulkProductReader {
  /**
   * Warm whatever this adapter instance caches, for the given external ids.
   *
   * Called once per batch, before the per-product loop. The implementation may
   * fetch nothing at all — an adapter with no per-instance cache satisfies the
   * contract by doing so, and only a caller counting requests can tell.
   *
   * Must not throw for a partial answer. An id the master no longer has is left
   * unwarmed, so the per-product read raises the deletion signal as it always
   * did; deciding deletion here would put that authority on a best-effort path.
   */
  prefetchProducts(externalIds: readonly string[]): Promise<void>;
}

export function isBulkProductReader(
  adapter: ProductMasterPort
): adapter is ProductMasterPort & BulkProductReader {
  return typeof (adapter as Partial<BulkProductReader>).prefetchProducts === 'function';
}
