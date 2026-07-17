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
import { INVENTORY_REPOSITORY_TOKEN } from '../../inventory.tokens';
import { InventoryRepositoryPort } from '../../domain/ports/inventory-repository.port';
import type { InventoryItem } from '../../domain/entities/inventory-item.entity';
import type {
  InventoryFilters,
  InventoryPagination,
  VariantAvailability,
  ProductStockAggregate,
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

@Injectable()
export class InventoryQueryService implements IInventoryQueryService {
  constructor(
    @Inject(INVENTORY_REPOSITORY_TOKEN)
    private readonly inventoryRepository: InventoryRepositoryPort,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService
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

    const rows = await this.inventoryRepository.findAvailabilityByVariantIds(variantIds);
    const byId = new Map(rows.map((r) => [r.productVariantId, r]));
    // Zero-fill unknowns so the caller can build a Map<variantId, …> directly
    // without re-walking the input list. Output order preserves input order.
    return variantIds.map(
      (id) =>
        byId.get(id) ?? {
          productVariantId: id,
          totalAvailable: 0,
          locationCount: 0,
        }
    );
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
