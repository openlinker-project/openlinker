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
import type {
  InventoryAdjustment,
  InventoryAdjustmentOutcome,
} from '../types/inventory.types';

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
 * What {@link InventoryMasterPort.adjustInventory} returns (#2368).
 *
 * The post-adjustment inventory, plus an OPTIONAL report on what the master did
 * with the adjustment. Every added member is optional, which is what makes this
 * a source-compatible widening: an existing implementer declaring
 * `Promise<Inventory>` still satisfies the amended signature, and an existing
 * caller reading only `Inventory` fields is untouched.
 *
 * Declared here rather than in `inventory.types.ts` because it extends
 * {@link Inventory}, which this file owns; the outcome vocabulary it carries
 * lives in the types file with every other inventory type.
 */
export interface InventoryAdjustmentResult extends Inventory {
  /**
   * The adapter's report on the adjustment.
   *
   * **Absent means "not reported"**, i.e. an adapter that predates #2368 — a
   * caller MUST treat that exactly as `idempotency: 'unsupported'`. Reading an
   * absent outcome as a honoured dedupe would let a retry silently skip a
   * restock that never happened.
   */
  adjustmentOutcome?: InventoryAdjustmentOutcome;
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
   * Adjusts the inventory quantity for a product or variant. An implementation
   * that cannot write stock throws its own platform `NotSupported` error, which
   * a caller surfaces as a loud refusal — never as a silent success, because a
   * restock that quietly no-ops is worse than one that never ran.
   *
   * ## Idempotency (#2368)
   *
   * `adjustment.idempotencyKey` is OPTIONAL and so is honouring it. An
   * implementer that recognises a repeated key MUST apply nothing and report
   * `disposition: 'deduplicated'` with `idempotency: 'honoured'`; one that
   * cannot dedupe MUST report `idempotency: 'unsupported'` rather than leave the
   * caller to assume the key did something. Reporting nothing at all
   * (`adjustmentOutcome` absent) is legal — it is what every pre-#2368 adapter
   * does — and a caller reads it as `'unsupported'`.
   *
   * Honouring a key is best-effort within whatever window the implementer
   * declares; the caller-side guarantee this exists to serve is that a RETRY of
   * the same logical adjustment does not double-apply.
   *
   * ## Reason (#2368)
   *
   * `adjustment.reason` is a closed, marketplace-neutral vocabulary. An
   * implementer carries it to the master where the master has somewhere to put
   * it, and logs it where it does not. It is never invented and never mapped to
   * a value the platform did not ask for.
   *
   * @param adjustment - Inventory adjustment details
   * @returns Updated inventory with internal IDs, plus an optional outcome report
   * @throws NotSupportedException if the platform exposes no stock write
   */
  adjustInventory(adjustment: InventoryAdjustment): Promise<InventoryAdjustmentResult>;

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
