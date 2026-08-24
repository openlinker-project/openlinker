/**
 * Inventory Master Port
 *
 * Defines the contract for inventory/stock level operations. This port represents
 * the single source of truth for inventory data. Adapters implementing this port
 * are responsible for:
 * - Fetching inventory from external platforms
 * - Transforming external inventory data to OpenLinker unified schema
 * - Replacing external IDs with internal OpenLinker IDs using IdentifierMappingService
 * - Translating a master-side deletion into `MasterProductNotFoundError`
 *   (see the error contract on `getInventory` / `listInventory` below)
 *
 * @module libs/core/src/inventory/domain/ports
 */
import type { InventoryAdjustment } from '../types/inventory.types';

/**
 * Inventory domain entity (minimal interface for port)
 * Full entity definition should be in domain/entities/inventory.entity.ts
 */
export interface Inventory {
  id: string;
  productId: string;
  variantId?: string;
  locationId?: string;
  quantity: number;
  reserved: number;
  available: number;
  updatedAt?: Date;
}

/**
 * Inventory Master Port
 *
 * Single source of truth for inventory/stock levels.
 *
 * ## Error contract for the two read methods (#1688)
 *
 * An implementer MUST translate a **master-side deletion** — the platform
 * itself reporting the product absent (a 404 / empty resource fetch on the
 * *product*) — into the neutral `MasterProductNotFoundError` from
 * `@openlinker/core/products`. `MasterInventorySyncService` treats that error as
 * "deleted at the master": it stales every one of the product's inventory rows,
 * emits `master.product.stale`, and the worker handler terminalises the job as
 * `outcome: 'business_failure'` (ADR-007) so a permanent condition is not
 * retried.
 *
 * Because those consequences are permanent, an implementer MUST NOT use it for
 * anything weaker than a platform-reported product absence. In particular these
 * stay platform-native (retryable, diagnosable) errors:
 * - no identifier mapping for the connection (a mapping gap)
 * - a corrupted mapping (e.g. a non-numeric external id)
 * - an inferred absence, such as "the product resolves but carries no stock
 *   rows" — probe the product resource before concluding deletion
 *
 * Any other failure (network, auth, 5xx) must propagate unchanged so the job
 * stays retryable.
 */
export interface InventoryMasterPort {
  /**
   * Get current inventory for a product
   *
   * Fetches the current inventory/stock level for a product (or variant).
   * The adapter must resolve the internal ID to external ID using IdentifierMappingService.
   *
   * @param productId - Internal OpenLinker product ID
   * @param locationId - Optional location ID (for multi-location inventory)
   * @returns Inventory with internal IDs
   * @throws MasterProductNotFoundError if the product is absent at the master
   *   (see the error contract on this interface)
   */
  getInventory(productId: string, locationId?: string): Promise<Inventory>;

  /**
   * List all inventory for a product, broken down by variant.
   *
   * Returns one `Inventory` entry per variant: a simple product yields a single
   * entry keyed to its synthetic variant; a combination product yields one entry
   * per combination, each with `variantId` set. This is the source the master
   * inventory sync uses to write one variant-keyed row per combination (#823).
   * Marketplace-agnostic — any inventory master expresses per-variant stock the
   * same way.
   *
   * @param productId - Internal OpenLinker product ID
   * @returns One Inventory per variant, each with internal IDs
   * @throws MasterProductNotFoundError if the product is absent at the master
   *   (see the error contract on this interface)
   */
  listInventory(productId: string): Promise<Inventory[]>;

  /**
   * Adjust inventory (increase or decrease)
   *
   * Adjusts the inventory quantity for a product or variant.
   * For MVP, this may throw NotSupportedException.
   *
   * @param adjustment - Inventory adjustment details
   * @returns Updated inventory with internal IDs
   * @throws NotSupportedException if not supported in MVP
   */
  adjustInventory(adjustment: InventoryAdjustment): Promise<Inventory>;

  /**
   * Reserve inventory for an order
   *
   * @deprecated (#2315, ADR-061). No shipped master exposes a hold primitive, so
   * both implementations (`WooCommerceInventoryMasterAdapter`,
   * `PrestashopInventoryMasterAdapter`) throw `NotSupported` and there is no
   * production caller. Reservations are now OL's own concern: the advisory
   * reservation ledger owned by the inventory context holds stock against an
   * order (never a decrement, `expiresAt` mandatory), and ATP is answered by the
   * `AvailabilityAuthority` capability — see ADR-061 §Decision (1)-(2).
   *
   * The legitimate residual need — pushing a hold to a master that *does* model
   * one — returns as an optional `MasterReservationWriter` sub-capability,
   * deliberately deferred until an adapter exists that can implement it
   * (ADR-061 reversal gate). It will NOT come back on this port.
   *
   * NOT removed: this is a published contract that out-of-tree plugins compile
   * against, and the WooCommerce master-shop guide documents the current
   * behaviour. Removal is deferred to a contract-major cycle
   * (ANALYSIS-1032 §5 / DESIGN-oms-authority-model §4.2). Implementers should
   * keep throwing `NotSupported`; new adapters should not implement it.
   *
   * @param productId - Internal OpenLinker product ID
   * @param quantity - Quantity to reserve
   * @param orderId - Internal OpenLinker order ID
   * @throws NotSupportedException - always, in every shipped adapter
   */
  reserveInventory(productId: string, quantity: number, orderId: string): Promise<void>;

  /**
   * Release reserved inventory
   *
   * @deprecated (#2315, ADR-061). The counterpart of the deprecated
   * `reserveInventory` above — same rationale, same successor (OL's own advisory
   * reservation ledger; release is expiry- or consume-driven there), same
   * deferred `MasterReservationWriter`, same "not removed, contract-major cycle"
   * policy. Implementers should keep throwing `NotSupported`.
   *
   * @param productId - Internal OpenLinker product ID
   * @param quantity - Quantity to release
   * @param orderId - Internal OpenLinker order ID
   * @throws NotSupportedException - always, in every shipped adapter
   */
  releaseInventory(productId: string, quantity: number, orderId: string): Promise<void>;

  /**
   * Get available quantity (total - reserved)
   *
   * Returns the available quantity for a product (total quantity minus reserved).
   * The adapter must resolve the internal ID to external ID using IdentifierMappingService.
   *
   * @param productId - Internal OpenLinker product ID
   * @param locationId - Optional location ID (for multi-location inventory)
   * @returns Available quantity (number)
   */
  getAvailableQuantity(productId: string, locationId?: string): Promise<number>;
}
