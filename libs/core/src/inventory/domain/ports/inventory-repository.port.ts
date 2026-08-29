/**
 * Inventory Repository Port
 *
 * Defines the contract for inventory persistence operations. Implemented by
 * infrastructure repositories to provide inventory storage capabilities.
 * This port abstracts the database implementation, allowing the application
 * layer to work with domain entities without depending on specific infrastructure.
 *
 * @module libs/core/src/inventory/domain/ports
 * @see {@link InventoryRepository} for the TypeORM implementation
 */
import type { InventoryItem } from '../entities/inventory-item.entity';
import type {
  InventoryFilters,
  InventoryPagination,
  PaginatedInventoryItems,
  VariantStockRow,
  ProductStockAggregate,
  PruneStaleVariantsResult,
  ProvenanceScope,
  DuplicatePositionReport,
  InventoryPositionCandidate,
} from '../types/inventory.types';

/**
 * Inventory Repository Port
 *
 * Interface for inventory persistence operations. Implementations handle
 * the specifics of the underlying database technology (TypeORM, etc.)
 * and map between domain entities and ORM entities.
 */
export interface InventoryRepositoryPort {
  /**
   * Find inventory by product and variant, optionally scoped to one connection's
   * provenance (#2320, ADR-058 decision (4)).
   *
   * ## The null/undefined asymmetry — read this before adding a caller
   *
   * The last two parameters are IDENTITY columns and the fourth is a PROVENANCE
   * axis, and they read `null` differently on purpose:
   *
   * - `productVariantId` / `locationId` — `undefined` and `null` are the same
   *   and both mean **"match rows whose column IS NULL"**. A product-level row
   *   is genuinely the row with `productVariantId IS NULL`; there is no
   *   "unspecified" reading available, because omitting the column would match
   *   a different row.
   * - `sourceConnectionId` — `undefined` and `null` are the same and both mean
   *   **"no provenance axis: behave exactly as this method did before #2320"**,
   *   i.e. an unscoped lookup that matches a row whatever its provenance.
   *
   * Reading `null` here as "match rows whose provenance IS NULL" would be the
   * wrong half of the asymmetry and is a real defect, not a nuance: the three
   * axis-less callers would then stop finding rows that already carry
   * provenance, and each would insert a duplicate position instead of updating
   * the row it meant to. The #2314 "stamps provenance onto an existing NULL row
   * in place" integration test is the canary for exactly that mistake.
   *
   * When an axis IS supplied, the match is the claim rule
   * {@link ProvenanceScope} documents: the row's provenance equals the given id,
   * OR is unattributed (NULL or `'legacy'`). Unattributed rows are always
   * claimable here, with no rival check — the repository cannot reach the claim
   * service (layering), and refusing to claim would insert a duplicate row on
   * every single-source install, which is the regression this slice must not
   * cause. The staleness prune, which CAN reach the guard, keeps it.
   *
   * Several rows can satisfy a scoped match (one owned, one unattributed), so
   * the result is deterministic by construction: own-provenance rows sort first,
   * then by `id`. Preferring the connection's own row is what makes repeated
   * syncs converge on one position instead of alternating.
   *
   * @param productId - Internal OpenLinker product ID
   * @param productVariantId - Internal OpenLinker variant ID (optional, for variant-level stock)
   * @param locationId - Location ID (optional, for multi-location inventory)
   * @param sourceConnectionId - Claiming connection, or `null`/omitted for an unscoped lookup
   * @returns Inventory item domain entity or null if not found
   */
  findByProductAndVariant(
    productId: string,
    productVariantId?: string | null,
    locationId?: string | null,
    sourceConnectionId?: string | null
  ): Promise<InventoryItem | null>;

  /**
   * Upsert inventory item (create or update by unique constraint)
   *
   * Upserts inventory by unique constraint: (productId, productVariantId, locationId).
   * If productVariantId is null, uses base inventory constraint.
   *
   * On an EXISTING row the write is **column-scoped** (#2071): only the columns
   * the master sync owns are written (`availableQuantity`, `reservedQuantity`,
   * `isStale`, `sourceConnectionId`). The row's identity columns are never
   * rewritten, and `updatedAt`
   * is left to the database — so the returned item's `updatedAt` is the
   * DB-stamped value, NOT the `item.updatedAt` the caller passed in.
   * `InventorySyncService` builds the propagation dedupe key from that value,
   * which is why the master's timestamp must not survive the round-trip.
   *
   * **Precondition on `isStale`:** it is in the owned set only because
   * `MasterInventorySyncService` runs its `setInventory` loop BEFORE
   * `pruneStaleVariants`, keeping the two write sets disjoint. A new caller that
   * breaks that ordering must move `isStale` out of the owned set.
   *
   * `sourceConnectionId` (ADR-058 ladder step (i), #2314) is written on both
   * branches, so a pre-existing row acquires provenance on its next sync. A
   * caller with no connection axis passes `null`, which persists as "provenance
   * unknown" — legal until the #2317 backfill.
   *
   * **The internal lookup is provenance-scoped (#2320).** The axis is derived
   * from `item.sourceConnectionId` — there is no signature change and no second
   * argument, because the item already carries the only value that could be
   * passed and a caller able to disagree with itself would be a bug surface
   * rather than a feature. An item with `null` provenance keeps the pre-#2320
   * unscoped lookup exactly. This is what stops connection B matching and
   * clobbering connection A's row (ADR-058 decision (4)); B now correctly finds
   * no row of its own and inserts one.
   *
   * @param item - Inventory item domain entity with internal IDs
   * @returns Upserted inventory item domain entity, carrying the DB-stamped `updatedAt`
   * @throws InventoryRowVanishedError if the matched row disappeared before the scoped UPDATE
   * @throws InventoryReturningUnsupportedError if the driver returned no usable `updatedAt`
   * @throws InventoryCrossSourcePositionConflictError if a second source's INSERT
   *   collides with an existing row's position at a NON-NULL `locationId`, where
   *   the NULL-distinct partial unique indexes cannot admit both rows until #2325
   */
  upsert(item: InventoryItem): Promise<InventoryItem>;

  /**
   * Find inventory items with filters and pagination.
   *
   * `filters.sourceConnectionId` (#2320) narrows to one connection's positions
   * with STRICT equality — unlike the write-path lookup, a read never claims
   * unattributed rows, because reporting another connection's unowned stock as
   * this one's would misstate whose inventory the operator is looking at.
   */
  findMany(
    filters: InventoryFilters,
    pagination: InventoryPagination
  ): Promise<PaginatedInventoryItems>;

  /**
   * Summed per-variant availability across all locations for the given
   * variant IDs (#792 PR 2). Returns rows ONLY for variants that have at
   * least one matching inventory row; zero-filling for unknown variants is
   * the service layer's responsibility. Empty input → empty output.
   *
   * Each row also carries `stockUpdatedAt` (`MAX(updatedAt)` across the
   * variant's live positions, #2321) — the observation time
   * `IAvailabilityService` reports as `PromisableQuantity.observedAt`.
   *
   * @param variantIds list of internal product-variant IDs to look up
   * @returns one VariantStockRow per variant with inventory
   */
  findAvailabilityByVariantIds(
    variantIds: readonly string[]
  ): Promise<readonly VariantStockRow[]>;

  /**
   * Every LIVE position an order's lines could be reserved against (#2344).
   *
   * Deliberately **not** a sum and deliberately **not** a single-row resolve:
   * `findAvailabilityByVariantIds` above collapses a variant's positions into
   * one total and `findByProductAndVariant` picks one row, so neither can tell a
   * caller that a variant resolved to SEVERAL positions — the condition
   * ANALYSIS-1032 § 6I's multi-position guard has to reject loudly, because a
   * reserve's `UPDATE … WHERE id = $1` takes exactly one of them.
   *
   * Keyed by **product** rather than variant so one bound-parameter statement
   * serves a whole order, with `productVariantIds` narrowing inside it: without
   * that narrowing a 500-SKU apparel product would return 500 rows for a
   * one-line order, since variant-count-per-product — not order size — is the
   * growth axis. Product-level positions (`productVariantId IS NULL`) are always
   * included, because a line with no variant resolves against exactly those.
   *
   * `isStale = false` only, matching § 6I's claim predicate and the filter
   * `findAvailabilityByVariantIds` already applies: a stale position must never
   * accept a new promise.
   *
   * Empty `productIds` returns `[]` without a storage round trip.
   */
  findLivePositionsByProductIds(
    productIds: readonly string[],
    productVariantIds: readonly string[]
  ): Promise<readonly InventoryPositionCandidate[]>;

  /**
   * Product-level stock aggregates for the given product IDs (#1720).
   *
   * Sums availableQuantity / reservedQuantity and takes MAX(updatedAt) across
   * each product's live (non-stale) inventory rows. Returns rows ONLY for
   * products that have at least one matching inventory row - products absent
   * from the result simply have no inventory; the caller decides whether to
   * zero-fill. Empty input returns [] without a storage round-trip.
   *
   * @param productIds list of internal product IDs to aggregate
   * @returns one ProductStockAggregate row per product with inventory
   */
  findStockAggregatesByProductIds(
    productIds: readonly string[]
  ): Promise<readonly ProductStockAggregate[]>;

  /**
   * Soft-mark orphaned inventory rows as stale (#1478).
   *
   * Marks every currently-live (`isStale = false`) row for `productId` whose
   * `productVariantId` is NOT in `keepVariantIds` as stale. `keepVariantIds` is
   * the set of variant keys present in the master's latest `listInventory`
   * response — including `null` for a product-level row. An empty keep set marks
   * every row for the product stale (the product was fully removed at the master).
   *
   * Does not touch already-stale rows, and does not bump `updatedAt` (a bulk
   * UPDATE, not a save) — so `updatedAt` keeps reflecting the last real stock
   * write. A variant that reappears clears its own flag via the upsert path.
   *
   * Granularity is per-variant, not per-location: a still-present variant that
   * the master stops returning at one specific location keeps all its location
   * rows live (the variant is still in `keepVariantIds`). Multi-location pruning
   * is out of scope.
   *
   * **Optionally scoped to one connection's provenance (#2320).** With `scope`
   * omitted the sweep is unscoped and byte-identical to its pre-#2320 behaviour
   * — which is what the published port promises every existing caller, and what
   * the same-named `ProductVariantRepository` sibling (which has no provenance
   * column at all) keeps doing. With `scope` supplied, only rows matching the
   * claim rule in {@link ProvenanceScope} are eligible, so one master's prune
   * can no longer stale a rival master's rows.
   *
   * Note what the scope does NOT do: it is not a substitute for the #1904
   * rival-claimant guard. `includeUnattributedProvenance: true` claims rows
   * nobody owns, and that is only safe where a caller has already established
   * it is the sole claimant — see the invariant comment at the
   * `MasterInventorySyncService` call sites.
   *
   * @param productId internal OpenLinker product ID
   * @param keepVariantIds variant keys to keep live (may include `null`)
   * @param scope optional provenance restriction; omitted ⇒ unscoped sweep
   * @returns rows newly marked stale (`markedCount`) + the distinct non-null
   *   variant ids flagged (`variantIds`, for the master-deletion event)
   */
  markStaleExceptVariants(
    productId: string,
    keepVariantIds: readonly (string | null)[],
    scope?: ProvenanceScope
  ): Promise<PruneStaleVariantsResult>;

  /**
   * Enforce ADR-058 decision (2) — "`locationId IS NULL` means the master
   * declines to locate, never a default location" (#2322).
   *
   * A source that starts reporting located positions for a variant it used to
   * report pooled leaves its OWN pooled row behind. That row is not a second
   * warehouse: it is the same stock, counted twice, because a `NULL`
   * `locationId` is an absence of an answer rather than a location named
   * "default". This soft-stales exactly those orphans — the source's own
   * `locationId IS NULL` rows for the variants it just located — using the
   * existing `isStale` mechanism (#1478): no DELETE, no `updatedAt` bump, and
   * the row leaves availability through the `isStale = false` filters every
   * read already applies.
   *
   * **A repair, not a refusal.** The located write has already happened when
   * this runs; refusing it would leave the master's own answer unrecorded, and
   * a DB constraint cannot express the rule at all before the four-column index
   * (#2325). Reversal is free and needs no code: a source that stops locating
   * re-creates and un-stales its pooled row through the ordinary
   * `setInventory` upsert, and its located rows then stale via the ordinary
   * `markStaleExceptVariants` prune.
   *
   * **The scope is REQUIRED, unlike `markStaleExceptVariants`'s.** An unscoped
   * sweep here would stale a RIVAL master's legitimately-pooled row on the
   * strength of THIS master's decision to locate — a decision that says nothing
   * about the rival's stock. There is no meaningful unscoped form, so the type
   * does not offer one. `includeUnattributedProvenance` carries the same
   * caveat as everywhere else: claiming a row nobody owns is only safe for a
   * caller that has established it is the sole claimant (#1904).
   *
   * Emits nothing. Re-locating a variant is not a master-side deletion, so the
   * `master.variant.stale` event (#1599/#1689) must NOT fire off this count —
   * it would pause live marketplace offers for stock that is still there.
   *
   * @param productId internal OpenLinker product ID
   * @param locatedVariantKeys variant keys the master just reported at a
   *   non-null location (may include `null` for a product-level position)
   * @param scope the claiming connection's provenance restriction
   * @returns rows newly marked stale (`markedCount`) + the distinct non-null
   *   variant ids flagged (`variantIds`), reported for logging only
   */
  markLocationlessStaleForSource(
    productId: string,
    locatedVariantKeys: readonly (string | null)[],
    scope: ProvenanceScope
  ): Promise<PruneStaleVariantsResult>;

  /**
   * Read-only scan for duplicate inventory positions (#2319, ADR-058 step (iii)).
   *
   * Groups every `inventory_items` row by the FOUR-column position key
   * (`productId`, `productVariantId`, `locationId`, `sourceConnectionId`) under
   * SQL `GROUP BY` NULL-equality and reports the groups holding more than one
   * row. Provenance is part of the key deliberately — see
   * {@link DuplicatePositionGroup}.
   *
   * Writes nothing. Includes stale rows (a stale duplicate still collides under
   * the index #2325 creates). Reports UNCAPPED totals alongside capped detail:
   * `groupCount` is the #2325 readiness gate and must reflect the whole table
   * even when `maxGroups` truncates `groups`.
   *
   * Deliberately takes no filter arguments. A filtered scan could report a clean
   * subset of a dirty table, and the gate's whole value is that it speaks for
   * the table the index will be built over.
   *
   * @param maxGroups upper bound on returned group DETAIL (totals are unbounded)
   */
  findDuplicatePositions(maxGroups: number): Promise<DuplicatePositionReport>;

  /**
   * Stamp the `'legacy'` provenance sentinel onto at most `limit` rows whose
   * `sourceConnectionId` is still NULL (#2317, ADR-058 ladder step (ii)).
   *
   * **The predicate is the cursor.** There is no offset argument and there must
   * never be one: `sourceConnectionId IS NULL` is self-consuming, so each call
   * removes its own page from the candidate set. An advancing offset over a
   * shrinking set steps over rows and leaves them unstamped forever — which
   * #2325 would then discover as a `SET NOT NULL` that cannot run.
   *
   * Writes exactly one column. `updatedAt` must NOT move: `InventorySyncService`
   * derives the propagation job's dedupe key from it, so bumping it across the
   * whole table would either replay every propagation or collide keys and drop
   * them. That requirement is what forces a raw statement here — see the
   * implementation.
   *
   * Concurrency-safe against a live sync by construction: rows already claimed
   * by another transaction are skipped rather than waited on, and a real
   * connection id written concurrently simply removes the row from this
   * predicate. The sentinel can only ever lose to a real id, never overwrite
   * one.
   *
   * @param limit maximum rows to stamp in this call (caller floors and clamps)
   * @returns how many rows this call actually stamped
   */
  backfillLegacyProvenance(limit: number): Promise<number>;

  /**
   * How many `inventory_items` rows still carry no provenance (#2317).
   *
   * The backfill's completion predicate and #2325's readiness gate read the
   * same number. Uncapped and unfiltered on purpose: a count of a subset could
   * report done while rows the `NOT NULL` will trip over sit outside it.
   */
  countMissingProvenance(): Promise<number>;
}
