/**
 * Bulk Inventory Reader Capability
 *
 * Optional sub-capability of `InventoryMasterPort` - the inventory-side twin of
 * `BulkProductReader` (#2593), added by #2648 for the same reason and with the
 * same shape. A master that can read stock for MANY products in a handful of
 * requests declares `implements BulkInventoryReader`; one that can only answer
 * a product at a time simply does not, and the per-product path it already has
 * stays correct.
 *
 * The rung is a PREFETCH, not a second sync path. It is deliberately shaped as
 * a void-returning warm-up rather than "return me N inventories", because the
 * whole per-product pipeline behind `syncFromMasterByExternalId` - identifier
 * mapping, the variant-keyed write (#822/#823), the #1904 rival-claimant prune
 * guard, the #1688 deletion signal - has to keep running exactly as it does
 * today. A second path returning hydrated inventories would have to
 * re-implement all of it, and every guard re-implemented is a guard that can
 * drift. So the caller warms the adapter and then runs the unchanged loop.
 *
 * That makes one property load-bearing: the prefetch must be invisible except
 * in request count. Nothing may behave differently because it ran, and a
 * failure must degrade to the per-product reads rather than fail the batch.
 *
 * Naming: sub-capabilities drop the `Port` suffix - they layer onto
 * `InventoryMasterPort`, they are not independent top-level ports.
 *
 * Guard-only: this name is deliberately NOT in any adapter manifest and NOT in
 * `CoreCapabilityValues`, for the reason `modified-product-lister.capability.ts`
 * states at length - a connection's `enabledCapabilities` is stamped at create
 * and never retro-filled, so gating on a newly advertised name would drain
 * nothing for every connection that already exists.
 *
 * @module libs/core/src/inventory/domain/ports/capabilities
 * @see {@link InventoryMasterPort} for the base port
 */
import type { InventoryMasterPort } from '../inventory-master.port';

export interface BulkInventoryReader {
  /**
   * Warm whatever this adapter instance caches, for the given INTERNAL product
   * ids - the same ids `listInventory` takes, so a caller never has to resolve
   * anything before warming.
   *
   * Called once per batch, before the per-product loop. The implementation may
   * fetch nothing at all - an adapter with no per-instance cache satisfies the
   * contract by doing so, and only a caller counting requests can tell.
   *
   * Must not throw for a partial answer. A product the master no longer has is
   * left unwarmed, so the per-product read raises the deletion signal as it
   * always did; deciding deletion here would put that authority on a
   * best-effort path.
   */
  prefetchInventory(internalProductIds: readonly string[]): Promise<void>;
}

export function isBulkInventoryReader(
  adapter: InventoryMasterPort
): adapter is InventoryMasterPort & BulkInventoryReader {
  return typeof (adapter as Partial<BulkInventoryReader>).prefetchInventory === 'function';
}
