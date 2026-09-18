/**
 * Inventory Query Service
 *
 * Application service that composes canonical inventory items with their
 * master-catalog product details. Centralises the cross-aggregate read that
 * was previously orchestrated in the HTTP controller, keeping the interface
 * layer responsible only for transport shape.
 *
 * @module libs/core/src/inventory/application/services
 * @implements {IInventoryQueryService}
 * @see {@link IInventoryQueryService} for the service interface
 * @see {@link InventoryRepositoryPort} for inventory persistence
 * @see {@link IProductsService} for cross-context product reads (#718)
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  coverImageUrl,
  IProductsService,
  PRODUCTS_SERVICE_TOKEN,
} from '@openlinker/core/products';
import type { Product } from '@openlinker/core/products';
import {
  ConnectionNotFoundException,
  ConnectionPort,
  CONNECTION_PORT_TOKEN,
} from '@openlinker/core/identifier-mapping';
import {
  ISyncCursorsService,
  SYNC_CURSORS_SERVICE_TOKEN,
  masterSweepCompletedAtCursorKey,
  type MasterSweepKind,
} from '@openlinker/core/sync';
import {
  AVAILABILITY_SERVICE_TOKEN,
  INVENTORY_REPOSITORY_TOKEN,
  LOCATION_SERVICE_TOKEN,
} from '../../inventory.tokens';
import { IAvailabilityService } from './availability.service.interface';
import { ILocationService } from './location.service.interface';
import { SYSTEM_CONNECTION_ID } from './inventory.service';
import { InventoryRepositoryPort } from '../../domain/ports/inventory-repository.port';
import type { InventoryItem } from '../../domain/entities/inventory-item.entity';
import {
  LEGACY_SOURCE_CONNECTION_ID,
  type InventoryFilters,
  type InventoryPagination,
  type VariantAvailability,
  type VariantStockRow,
  type ProductStockAggregate,
  type DuplicatePositionGroup,
  type DuplicatePositionReport,
  type ProvenanceBackfillStatus,
} from '../../domain/types/inventory.types';
import type {
  InventoryItemView,
  InventoryViewProduct,
  PaginatedInventoryView,
} from '../types/inventory-view.types';
import type { IInventoryQueryService } from './inventory-query.service.interface';

// Per-call input cap for the product-level stock aggregate read (#1720) -
// mirrors the 200-ID request cap on the variant-availability endpoint
// (INVENTORY_AVAILABILITY_MAX_VARIANT_IDS).
const MAX_STOCK_AGGREGATE_PRODUCT_IDS = 200;

/**
 * The sweep-key namespace `InventoryProvenanceBackfillHandler` owns —
 * declared locally to match that handler's own convention (see its header)
 * rather than imported, since the handler's `BACKFILL_SWEEP_KIND` is not
 * exported from a shared module. The nil-UUID scope the pass runs under IS
 * shared, as `SYSTEM_CONNECTION_ID` from `./inventory.service` — reused here
 * rather than re-declared, per `scripts/check-system-connection-id-mirror.mjs`
 * (#2745): a fifth independent copy in this context would be the one instance
 * that script cannot see drift on.
 */
const PROVENANCE_BACKFILL_SWEEP_KIND: MasterSweepKind = 'inventory-provenance';

/**
 * Hard cap on duplicate-position group DETAIL per call (#2319).
 *
 * Bounds only the `groups` array — `groupCount` / `rowCount` are always computed
 * over the whole table, because they are the #2325 readiness gate. Exported so
 * the HTTP DTO's `@Max` and this guard cannot drift.
 */
export const MAX_DUPLICATE_POSITION_GROUPS = 500;

/** Default duplicate-position group detail cap when the caller names none. */
export const DEFAULT_DUPLICATE_POSITION_GROUPS = 100;

/**
 * In-flight ceiling for the location/connection display-name fan-out (#3249
 * review). Distinct locations/connections are not bounded below group count
 * — `MAX_DUPLICATE_POSITION_GROUPS` allows 500 groups at 500 distinct
 * locations — so the id-set size alone is not a structural bound. Mirrors
 * the declared, clamped-ceiling shape ADR-047/#2229 established
 * (`resolveBatchConcurrency`) rather than relying on realistic cardinality.
 */
const DUPLICATE_POSITION_NAME_LOOKUP_CONCURRENCY = 10;

/**
 * Runs `worker` over `items` in fixed-size waves capped at `concurrency` —
 * the next wave starts only once the previous one fully settles.
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const cap = Math.max(1, concurrency);
  for (let i = 0; i < items.length; i += cap) {
    await Promise.all(items.slice(i, i + cap).map(worker));
  }
}

@Injectable()
export class InventoryQueryService implements IInventoryQueryService {
  constructor(
    @Inject(INVENTORY_REPOSITORY_TOKEN)
    private readonly inventoryRepository: InventoryRepositoryPort,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(AVAILABILITY_SERVICE_TOKEN)
    private readonly availabilityService: IAvailabilityService,
    @Inject(LOCATION_SERVICE_TOKEN)
    private readonly locationService: ILocationService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(SYNC_CURSORS_SERVICE_TOKEN)
    private readonly cursors: ISyncCursorsService
  ) {}

  async listInventoryItems(
    filters: InventoryFilters,
    pagination: InventoryPagination
  ): Promise<PaginatedInventoryView> {
    const { items, total } = await this.inventoryRepository.findMany(filters, pagination);
    const productMap = await this.buildProductMap(items.map((i) => i.productId));
    return {
      items: items.map((item) => this.compose(item, productMap.get(item.productId) ?? null)),
      total,
    };
  }

  async getAvailabilityByVariantIds(
    variantIds: readonly string[]
  ): Promise<readonly VariantAvailability[]> {
    // Short-circuit empty input to avoid an unnecessary repo call. The
    // controller's DTO validation rejects [] with 400, but a direct
    // service caller (or a test) should still get a sane shape rather
    // than crashing on `undefined.map(...)`.
    if (variantIds.length === 0) return [];

    const [rows, promisable] = await Promise.all([
      this.inventoryRepository.findAvailabilityByVariantIds(variantIds),
      // GLOBAL scope, deliberately (#2323): this read has no destination, and
      // the per-connection buffer is applied downstream by whichever publish
      // site consumes the row — asking for a channel scope here would either
      // require picking one connection arbitrarily or double-buffer.
      this.availabilityService.getPromisableQuantities({ variantIds, scope: { kind: 'global' } }),
    ]);
    const byId = new Map(rows.map((r) => [r.productVariantId, r]));
    // `getPromisableQuantities` is zero-filled and order-preserving, so this
    // map is total over `variantIds`; the `?? null` is unreachable defence.
    const atpById = new Map(promisable.map((p) => [p.productVariantId, p.quantity]));
    // Zero-fill unknowns so the caller can build a Map<variantId, …> directly
    // without re-walking the input list. Output order preserves input order.
    return variantIds.map((id) => {
      const row = byId.get(id);
      return {
        productVariantId: id,
        totalAvailable: row?.totalAvailable ?? 0,
        locationCount: row?.locationCount ?? 0,
        ...(row?.stockUpdatedAt !== undefined ? { stockUpdatedAt: row.stockUpdatedAt } : {}),
        // A variant with no positions carries a KNOWN zero, not `null` — the
        // #1844 master-is-authoritative-including-zero rule and #1689's
        // stale-variant pause both depend on a zero publish actually happening.
        availableToPromise: atpById.get(id) ?? null,
      };
    });
  }

  async findAvailabilityByVariantIds(
    variantIds: readonly string[]
  ): Promise<readonly VariantStockRow[]> {
    // No zero-fill, deliberately — see the interface docblock. The
    // repository read already returns one row per variant that HAS
    // non-stale inventory rows and nothing for the rest, so this is a
    // pass-through whose value is entirely in what it does NOT invent.
    if (variantIds.length === 0) return [];
    return this.inventoryRepository.findAvailabilityByVariantIds(variantIds);
  }

  async getProductStockAggregates(
    productIds: readonly string[]
  ): Promise<readonly ProductStockAggregate[]> {
    // Empty input short-circuits without a repo call (mirrors
    // getAvailabilityByVariantIds); the size cap protects the grouped query
    // from unbounded IN-lists - callers page their input (the products list
    // page passes at most one page of ids).
    if (productIds.length === 0) return [];
    if (productIds.length > MAX_STOCK_AGGREGATE_PRODUCT_IDS) {
      throw new Error(
        `getProductStockAggregates accepts at most ${String(MAX_STOCK_AGGREGATE_PRODUCT_IDS)} productIds per call (got ${String(productIds.length)})`
      );
    }
    return this.inventoryRepository.findStockAggregatesByProductIds(productIds);
  }

  async getDuplicatePositionReport(
    maxGroups: number = DEFAULT_DUPLICATE_POSITION_GROUPS
  ): Promise<DuplicatePositionReport> {
    // Throws rather than clamps, matching MAX_STOCK_AGGREGATE_PRODUCT_IDS above:
    // a caller that asked for more detail than it can have should learn so
    // rather than receive a silently different answer. On the HTTP path the
    // DTO's @Max(MAX_DUPLICATE_POSITION_GROUPS) yields a friendly 400 first;
    // this guard covers every other caller.
    if (!Number.isInteger(maxGroups) || maxGroups < 1) {
      throw new Error(
        `getDuplicatePositionReport requires a positive integer maxGroups (got ${String(maxGroups)})`
      );
    }
    if (maxGroups > MAX_DUPLICATE_POSITION_GROUPS) {
      throw new Error(
        `getDuplicatePositionReport accepts at most ${String(MAX_DUPLICATE_POSITION_GROUPS)} groups per call (got ${String(maxGroups)})`
      );
    }
    const report = await this.inventoryRepository.findDuplicatePositions(maxGroups);
    if (report.groups.length === 0) return report;
    return { ...report, groups: await this.enrichDuplicatePositionGroups(report.groups) };
  }

  async getProvenanceBackfillStatus(): Promise<ProvenanceBackfillStatus> {
    // remainingNull is live on every call, deliberately — see the
    // ProvenanceBackfillStatus docblock. rawLatchedAt is the backfill's own
    // persisted completion stamp (sweepCompletedAtCursorKey under the
    // nil-UUID system connection, written by
    // InventoryProvenanceBackfillHandler) — reading it alongside the live
    // count is what makes "still draining" and "latched, and stuck" (a later
    // mutation reintroduced a NULL row after completion) distinguishable.
    const [remainingNull, rawLatchedAt] = await Promise.all([
      this.inventoryRepository.countMissingProvenance(),
      this.cursors.getCursor(
        SYSTEM_CONNECTION_ID,
        masterSweepCompletedAtCursorKey(PROVENANCE_BACKFILL_SWEEP_KIND, SYSTEM_CONNECTION_ID)
      ),
    ]);
    // The handler's own "latched" predicate (see its `execute()`) treats an
    // empty-string cursor row identically to a null one — normalise here so
    // reader and writer agree on what a stored value means. Passing '' through
    // verbatim would report `latchedAt: ''` (non-null), which every consumer
    // of this docblock's contract reads as "latched" and prescribes deleting
    // a cursor row that is not stuck at all.
    const latchedAt = rawLatchedAt !== null && rawLatchedAt.length > 0 ? rawLatchedAt : null;
    return { remainingNull, completed: remainingNull === 0, latchedAt };
  }

  /**
   * Resolves display names for a duplicate-position report's groups (#3239).
   *
   * Batched across the UNIQUE ids in the whole `groups[]` array, never per
   * group — the same shape `buildProductMap` already uses for the composed
   * inventory-item view, and the `getEarliestOrderDateByConnection` (#2083)
   * precedent for a single batched read ahead of any per-row loop.
   *
   * `locationId`/`sourceConnectionId` have no batched-by-id read on their own
   * services today (`ILocationService.getLocation` and `ConnectionPort.get`
   * are both single-id), so each distinct id costs its own round trip. That
   * distinct-id count is NOT bounded below group count — `maxGroups` allows
   * up to `MAX_DUPLICATE_POSITION_GROUPS` groups at that many distinct
   * locations/connections — so the fan-out is capped at
   * `DUPLICATE_POSITION_NAME_LOOKUP_CONCURRENCY` in-flight lookups per axis
   * (the `resolveBatchConcurrency` / ADR-047 precedent) rather than an
   * unbounded `Promise.all` over the whole id set.
   */
  private async enrichDuplicatePositionGroups(
    groups: DuplicatePositionGroup[]
  ): Promise<DuplicatePositionGroup[]> {
    const productIds = groups.map((g) => g.productId);
    const locationIds = [
      ...new Set(groups.map((g) => g.locationId).filter((id): id is string => id !== null)),
    ];
    // null and the #2317 'legacy' sentinel both mean "not yet backfilled" —
    // neither names a real connection, so neither is ever resolved.
    const connectionIds = [
      ...new Set(
        groups
          .map((g) => g.sourceConnectionId)
          .filter((id): id is string => id !== null && id !== LEGACY_SOURCE_CONNECTION_ID)
      ),
    ];

    const [productMap, locationNameMap, connectionNameMap] = await Promise.all([
      this.buildProductMap(productIds),
      this.buildLocationNameMap(locationIds),
      this.buildConnectionNameMap(connectionIds),
    ]);

    return groups.map((group) => {
      const product = productMap.get(group.productId) ?? null;
      return {
        ...group,
        productName: product?.name ?? null,
        sku: product?.sku ?? null,
        locationName: group.locationId ? (locationNameMap.get(group.locationId) ?? null) : null,
        connectionName:
          group.sourceConnectionId && group.sourceConnectionId !== LEGACY_SOURCE_CONNECTION_ID
            ? (connectionNameMap.get(group.sourceConnectionId) ?? null)
            : null,
      };
    });
  }

  private async buildLocationNameMap(locationIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    await runWithConcurrency(
      locationIds,
      DUPLICATE_POSITION_NAME_LOOKUP_CONCURRENCY,
      async (id) => {
        const location = await this.locationService.getLocation(id);
        if (location) map.set(id, location.name);
      }
    );
    return map;
  }

  private async buildConnectionNameMap(connectionIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    await runWithConcurrency(
      connectionIds,
      DUPLICATE_POSITION_NAME_LOOKUP_CONCURRENCY,
      async (id) => {
        try {
          const connection = await this.connectionPort.get(id);
          map.set(id, connection.name);
        } catch (error) {
          // A deleted/unresolvable connection reports no name rather than
          // failing the whole report — the raw id is still shown.
          if (!(error instanceof ConnectionNotFoundException)) throw error;
        }
      }
    );
    return map;
  }

  private async buildProductMap(productIds: string[]): Promise<Map<string, Product>> {
    const uniqueIds = [...new Set(productIds)];
    const products = await this.productsService.getProductsByIds(uniqueIds);
    const map = new Map<string, Product>();
    for (const product of products) {
      map.set(product.id, product);
    }
    return map;
  }

  private compose(item: InventoryItem, product: Product | null): InventoryItemView {
    const viewProduct: InventoryViewProduct | null = product
      ? {
          name: product.name,
          sku: product.sku,
          // Cover-image rule owned by the Products domain; do not replicate here.
          coverImageUrl: coverImageUrl(product),
        }
      : null;
    return { item, product: viewProduct };
  }
}
