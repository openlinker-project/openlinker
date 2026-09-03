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
import { AVAILABILITY_SERVICE_TOKEN, INVENTORY_REPOSITORY_TOKEN } from '../../inventory.tokens';
import { IAvailabilityService } from './availability.service.interface';
import { InventoryRepositoryPort } from '../../domain/ports/inventory-repository.port';
import type { InventoryItem } from '../../domain/entities/inventory-item.entity';
import type {
  InventoryFilters,
  InventoryPagination,
  VariantAvailability,
  VariantStockRow,
  ProductStockAggregate,
  DuplicatePositionReport,
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
 * Hard cap on duplicate-position group DETAIL per call (#2319).
 *
 * Bounds only the `groups` array — `groupCount` / `rowCount` are always computed
 * over the whole table, because they are the #2325 readiness gate. Exported so
 * the HTTP DTO's `@Max` and this guard cannot drift.
 */
export const MAX_DUPLICATE_POSITION_GROUPS = 500;

/** Default duplicate-position group detail cap when the caller names none. */
export const DEFAULT_DUPLICATE_POSITION_GROUPS = 100;

@Injectable()
export class InventoryQueryService implements IInventoryQueryService {
  constructor(
    @Inject(INVENTORY_REPOSITORY_TOKEN)
    private readonly inventoryRepository: InventoryRepositoryPort,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(AVAILABILITY_SERVICE_TOKEN)
    private readonly availabilityService: IAvailabilityService
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
    return this.inventoryRepository.findDuplicatePositions(maxGroups);
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
