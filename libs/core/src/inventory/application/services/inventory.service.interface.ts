/**
 * Inventory Service Interface
 *
 * Defines the contract for inventory application operations. Implemented by
 * InventoryService to provide inventory management capabilities.
 *
 * @module libs/core/src/inventory/application/services
 * @see {@link InventoryService} for the implementation
 */
import type { InventoryItem } from '../../domain/entities/inventory-item.entity';
import type { PruneStaleVariantsResult, ProvenanceScope } from '../../domain/types/inventory.types';

/**
 * Inventory Service Interface
 *
 * Application service for inventory operations. Works with internal IDs only;
 * IdentifierMapping is handled by handlers, not by this service.
 */
export interface IInventoryService {
  /**
   * Set inventory (upsert by unique constraint)
   *
   * Upserts inventory by unique constraint: (productId, productVariantId, locationId).
   * If productVariantId is null, uses base inventory constraint.
   *
   * @param item - Inventory item domain entity with internal IDs
   * @returns Upserted inventory item domain entity
   */
  setInventory(item: InventoryItem): Promise<InventoryItem>;

  /**
   * Get inventory (optional but recommended)
   *
   * Thin wrapper over repository for future use cases (marketplace propagation,
   * API/UI visibility, reserved quantity logic) and debugging.
   *
   * `sourceConnectionId` (#2320) scopes the lookup to one connection's
   * provenance and is forwarded verbatim, `undefined` included. Omitting it
   * keeps the pre-#2320 unscoped behaviour — see
   * {@link InventoryRepositoryPort.findByProductAndVariant} for why `null` here
   * means "no axis" rather than "provenance IS NULL", unlike the identity
   * parameters beside it.
   *
   * @param productId - Internal OpenLinker product ID
   * @param productVariantId - Internal OpenLinker variant ID (optional, for variant-level stock)
   * @param locationId - Location ID (optional, for multi-location inventory)
   * @param sourceConnectionId - Claiming connection, or `null`/omitted for an unscoped lookup
   * @returns Inventory item domain entity or null if not found
   */
  getInventory(
    productId: string,
    productVariantId?: string | null,
    locationId?: string | null,
    sourceConnectionId?: string | null
  ): Promise<InventoryItem | null>;

  /**
   * Prune stale variants after a master sync (#1478).
   *
   * Soft-marks every currently-live inventory row for `productId` whose variant
   * is NOT in `currentVariantIds` (the variant keys present in the master's
   * latest `listInventory` response, including `null` for a product-level row).
   * Rows for variants deleted at the master are flagged `isStale` and excluded
   * from the variant-availability read the offer flows act on. A variant that
   * reappears clears its own flag via `setInventory`.
   *
   * `scope` (#2320) optionally restricts the sweep to one connection's
   * provenance, so one master's prune cannot stale a rival master's rows.
   * Omitted ⇒ the pre-#2320 unscoped sweep. It is NOT a replacement for the
   * #1904 rival-claimant guard — claiming unattributed rows is only safe for a
   * caller that has already established it is the sole claimant.
   *
   * @param productId internal OpenLinker product ID
   * @param currentVariantIds variant keys still present at the master (may include `null`)
   * @param scope optional provenance restriction
   * @returns rows newly marked stale (`markedCount`) + the distinct non-null
   *   variant ids flagged (`variantIds`), so the caller can emit a
   *   master-deletion event (#1599)
   */
  pruneStaleVariants(
    productId: string,
    currentVariantIds: readonly (string | null)[],
    scope?: ProvenanceScope
  ): Promise<PruneStaleVariantsResult>;

  /**
   * Enforce ADR-058 decision (2) after a master sync wrote located positions
   * (#2322): soft-stale the SAME source's own `locationId IS NULL` rows for the
   * variants it just located, since a pooled row left behind by a source that
   * started locating double-counts the same stock.
   *
   * `scope` is required — see the port docblock. Emits no event: re-locating is
   * not a deletion, and firing `master.variant.stale` off this count would
   * pause live offers (#1689).
   *
   * @param productId internal OpenLinker product ID
   * @param locatedVariantKeys variant keys reported at a non-null location
   * @param scope the claiming connection's provenance restriction
   * @returns rows newly marked stale + the distinct non-null variant ids
   */
  staleLocationlessPositionsForSource(
    productId: string,
    locatedVariantKeys: readonly (string | null)[],
    scope: ProvenanceScope
  ): Promise<PruneStaleVariantsResult>;
}
