/**
 * Post-Sale Inventory Refresh Service Interface
 *
 * The contract two unrelated hosts call: `OrderSyncService` inside core, and
 * the worker's `invoicing.issue` / `fiscalization.register` handlers. Those
 * handlers inject it by token, so the interface is what they depend on rather
 * than the concrete class - see the implementation's module docblock for why
 * `keyScope` is the whole idempotency design.
 *
 * @module libs/core/src/inventory/application/services
 */

/** What to re-read, and under which event's key. */
export interface PostSaleInventoryRefreshInput {
  /** OL-internal product ids the sale touched. Duplicates and blanks are ignored. */
  productIds: readonly string[];
  /**
   * Names the EVENT this refresh reacts to, e.g. `order:ol_order_x` or
   * `invoice:{recordId}`. Becomes the leading segment of the dedupe key - see
   * the implementation's module docblock for why it must never be counter- or
   * clock-derived.
   */
  keyScope: string;
}

export interface IPostSaleInventoryRefreshService {
  /**
   * Enqueue one `master.inventory.syncByExternalId` per
   * (`InventoryMaster`-capable connection x mapped product).
   *
   * Never throws: this is a latency optimisation on top of the sweep, so a
   * failure here must not disturb whatever committed the sale.
   */
  enqueue(input: PostSaleInventoryRefreshInput): Promise<void>;
}
