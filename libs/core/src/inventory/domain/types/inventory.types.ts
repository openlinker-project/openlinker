/**
 * Inventory Domain Types
 *
 * Type definitions for inventory domain operations. Defines inventory adjustment
 * types and other inventory-related types used across the inventory domain.
 *
 * @module libs/core/src/inventory/domain/types
 */
import type { InventoryItem } from '../entities/inventory-item.entity';

/**
 * The provenance sentinel for a position OpenLinker cannot attribute to any
 * connection (ADR-058 ladder step (ii), #2317).
 *
 * Written by the `inventory.provenance.backfill` sweep onto every row that
 * predates the `sourceConnectionId` column (#2314), so step (iii) can make the
 * column `NOT NULL` and put it in the position key without a table full of
 * NULLs blocking it (#2325).
 *
 * It is a VALUE, never a wildcard. A `'legacy'` row names one position whose
 * owner is unknown — it does not match every connection, and no read may treat
 * it as such. The moment a real sync claims the position it overwrites the
 * sentinel with its own connection id, which is the correct direction: the
 * unknown becomes known and never the reverse.
 *
 * A literal rather than a UUID deliberately: the column is `text` with no FK to
 * `connections`, precisely so a value like this can exist, and a nil-UUID
 * sentinel would be indistinguishable from a real id at a glance in a support
 * session. Named here, in the domain types, so the ORM column comment, the
 * migration that added the column, the sweep and #2325 all point at one
 * declaration instead of four copies of a string literal.
 */
export const LEGACY_SOURCE_CONNECTION_ID = 'legacy';

/**
 * Inventory adjustment
 *
 * Represents an inventory adjustment operation (increase or decrease).
 * Used by InventoryMasterPort for adjusting stock levels.
 */
export interface InventoryAdjustment {
  /**
   * Product ID (internal OpenLinker ID)
   */
  productId: string;

  /**
   * Variant ID (internal OpenLinker ID, optional)
   * If provided, adjustment applies to variant stock
   */
  variantId?: string;

  /**
   * Location ID (optional, for multi-location inventory)
   */
  locationId?: string;

  /**
   * Quantity to adjust (positive for increase, negative for decrease)
   */
  quantity: number;

  /**
   * Reason for adjustment (optional)
   */
  reason?: string;

  /**
   * Additional metadata (optional)
   */
  metadata?: Record<string, unknown>;
}

/**
 * Inventory filters for list queries
 */
export interface InventoryFilters {
  productId?: string;
  productVariantId?: string;
  locationId?: string;
  /**
   * Restrict the read to positions attributed to one connection (#2320).
   *
   * Repository-level only — no request DTO exposes it, and
   * `IInventoryQueryService` passes the filter object through opaquely. It
   * inherits this method's existing truthy-check semantics: an empty string is
   * indistinguishable from an absent filter and both mean "no provenance axis".
   * That is deliberate rather than a gap — there is no caller wanting to select
   * unattributed rows through this seam, and `''` is not a legal provenance
   * value, so no reachable query loses meaning.
   *
   * Strict equality, never the claim predicate {@link ProvenanceScope}
   * describes: a filtered READ that silently returned another connection's
   * unattributed rows would misreport whose stock the operator is looking at.
   */
  sourceConnectionId?: string;
}

/**
 * The provenance axis a write-path lookup or a staleness prune is scoped to
 * (#2320, ADR-058 decision (4)).
 *
 * An OBJECT rather than a bare string because the two fields are meaningless
 * apart: `sourceConnectionId` names the connection, and
 * `includeUnattributedProvenance` says whether rows nobody has claimed yet
 * count as this connection's. #2322 imports this same type, so keep the shape
 * and the field names stable.
 *
 * **NULL and `'legacy'` are ONE class — "unattributed".** A row that predates
 * the provenance column carries NULL until the #2317 sweep stamps
 * {@link LEGACY_SOURCE_CONNECTION_ID} on it; both mean the same thing ("no
 * connection has claimed this position"), so treating them as one class is what
 * makes the sweep's progress irrelevant to correctness here. Neither value is a
 * wildcard: the class is claimable, not matchable-by-everyone, and a row bearing
 * a RIVAL connection's id is never in it.
 */
export interface ProvenanceScope {
  /** The claiming connection. Matched with strict equality. */
  sourceConnectionId: string;
  /**
   * When true, rows whose provenance is NULL or `'legacy'` are treated as
   * belonging to `sourceConnectionId` — the claim rule above. When false, only
   * rows already stamped with that exact id match.
   */
  includeUnattributedProvenance: boolean;
}

/**
 * Pagination parameters for inventory queries
 */
export interface InventoryPagination {
  limit: number;
  offset: number;
}

/**
 * Paginated inventory items result
 */
export interface PaginatedInventoryItems {
  items: InventoryItem[];
  total: number;
}

/**
 * Per-variant stock facts summed across all live positions — the REPOSITORY
 * layer's shape.
 *
 * Returned by `InventoryRepositoryPort.findAvailabilityByVariantIds`, which
 * returns only matched rows. It is deliberately the narrower half of
 * {@link VariantAvailability}: the repository can sum positions, but it holds
 * neither the reservation ledger nor the per-destination buffer, so it cannot
 * answer available-to-promise. Splitting the two shapes (#2323) is what lets
 * `availableToPromise` be REQUIRED on the service-layer row without asking
 * persistence to populate a number it is in no position to know.
 */
export interface VariantStockRow {
  productVariantId: string;
  totalAvailable: number;
  locationCount: number;
  /**
   * `MAX(updatedAt)` across the variant's live positions (#2321) — when the
   * stock facts behind `totalAvailable` were last written.
   *
   * Additive, mirroring the `ProductStockAggregate.stockUpdatedAt` sibling.
   * `null` never occurs on a repo-returned row (a row exists only because a
   * position exists); the shape allows it for the service layer's zero-filled
   * entries, where "no positions" legitimately means "nothing was observed".
   * `IAvailabilityService` carries it through as `PromisableQuantity.observedAt`.
   */
  stockUpdatedAt?: Date | null;
}

/**
 * Per-variant inventory availability summed across all locations, plus the
 * available-to-promise answer (#2323, ADR-061).
 *
 * Returned by `IInventoryQueryService.getAvailabilityByVariantIds`, which
 * zero-fills entries for variants that have no inventory rows.
 *
 * Used by the bulk-wizard master-pull resolver (#792 PR 3).
 */
export interface VariantAvailability extends VariantStockRow {
  /**
   * Units OpenLinker will promise for this variant in the GLOBAL scope
   * (#2323) — `max(0, totalAvailable − Σ olReserved[published])`, with no
   * per-destination buffer applied, because a global read has no destination
   * whose cushion it could defensibly borrow. A publishing caller applies the
   * channel Control downstream through
   * `IAvailabilityService.applyPublishControls`, so nothing double-buffers.
   *
   * **`null` means OpenLinker does not know** (`provenance: 'unknown'` — the
   * reservation-ledger read failed), never "zero". A publishing caller MUST
   * suppress its write on `null` rather than fall back to `totalAvailable`:
   * falling back publishes the un-reserved quantity, overselling by exactly
   * the outstanding holds. A variant with no positions at all carries `0`,
   * which is a *known* zero (see `toPromisableQuantity`).
   *
   * Required rather than optional so a publishing caller cannot silently keep
   * reading `totalAvailable` while believing it honours reservations.
   */
  availableToPromise: number | null;
}

/**
 * Product-level stock aggregate across all of a product's inventory rows
 * (#1720 - products catalog cockpit).
 *
 * Returned by `InventoryRepositoryPort.findStockAggregatesByProductIds` and
 * `IInventoryQueryService.getProductStockAggregates`. Rows exist only for
 * products that have at least one live (non-stale) inventory row; the caller
 * decides how to treat absent products (the API layer zero-fills for display).
 */
export interface ProductStockAggregate {
  productId: string;
  totalAvailable: number;
  totalReserved: number;
  /** MAX(updatedAt) across the product's inventory rows; null never occurs on returned rows but the shape allows it for zero-filled callers */
  stockUpdatedAt: Date | null;
}

/**
 * Result of a stale-marking prune (#1478 / #1599). `markedCount` is the total
 * rows newly flagged (may exceed `variantIds.length` — multiple location rows
 * per variant); `variantIds` is the distinct set of non-null variant ids
 * flagged, used to emit the master-deletion event. Product-level rows
 * (`productVariantId = NULL`) contribute to `markedCount` but not `variantIds`.
 */
export interface PruneStaleVariantsResult {
  markedCount: number;
  variantIds: string[];
}






/**
 * One physical `inventory_items` row inside a duplicate group (#2319).
 *
 * Reported so an operator can decide which row survives remediation without a
 * second query. `updatedAt` is the DB-stamped write time, which is what the
 * documented survivor rule ("highest `updatedAt` among live rows") keys on.
 */
export interface DuplicatePositionRow {
  id: string;
  availableQuantity: number;
  reservedQuantity: number;
  /** Stale rows are INCLUDED in the report — see {@link DuplicatePositionGroup}. */
  isStale: boolean;
  updatedAt: Date;
}

/**
 * A set of `inventory_items` rows sharing one inventory-position key (#2319).
 *
 * **The key is all FOUR columns** — `productId`, `productVariantId`,
 * `locationId`, `sourceConnectionId` — matched with SQL `GROUP BY` NULL-equality
 * semantics (NULLs group together, the opposite of the NULL-distinct index
 * semantics that let these rows in). Provenance is part of the key because
 * ADR-058 decision (2) is explicit that cross-source coexistence is legitimate:
 * two rows for the same product/variant/location that differ only in which
 * connection's sync owns them are NOT duplicates, and reporting them as such
 * would permanently block the #2325 `SET NOT NULL` + unique-index step on a
 * healthy multi-source install.
 *
 * **Stale rows are included on purpose.** This is stricter than the availability
 * read (which excludes `isStale` rows): a stale duplicate still occupies the
 * key and would still collide under the index #2325 creates. `liveRowCount`
 * reports how many of the group's rows are live so an operator can see whether
 * the duplication is currently double-counting available-to-promise.
 */
export interface DuplicatePositionGroup {
  productId: string;
  productVariantId: string | null;
  locationId: string | null;
  sourceConnectionId: string | null;
  /** Total rows on this key (always > 1). */
  rowCount: number;
  /** Rows on this key with `isStale = false`. */
  liveRowCount: number;
  rows: DuplicatePositionRow[];
}

/**
 * Read-only duplicate-inventory-position report (#2319, ADR-058 ladder step (iii)).
 *
 * Detection only — nothing is repaired, nothing is written. Remediation is the
 * manual procedure in `docs/operations/inventory-duplicate-positions.md`.
 *
 * **`groupCount` is the Wave-1d gate for #2325 and is UNCAPPED**: it counts every
 * duplicate group in the table, not just the groups returned in `groups`. A
 * value of 0 means the recreated four-column unique index can be created; any
 * other value means it cannot. Keep the field name and its uncapped meaning
 * stable — #2325's precondition is expressed in terms of it.
 */
export interface DuplicatePositionReport {
  /** UNCAPPED count of duplicate groups — the #2325 gate. 0 ⇒ clean. */
  groupCount: number;
  /** UNCAPPED total rows across all duplicate groups. */
  rowCount: number;
  /** `rowCount - groupCount`: rows that would have to disappear for the index to build. */
  excessRowCount: number;
  /** Detail for at most `maxGroups` groups, largest first. */
  groups: DuplicatePositionGroup[];
  /** True when `groups.length < groupCount` — detail was capped, totals were not. */
  truncated: boolean;
}
