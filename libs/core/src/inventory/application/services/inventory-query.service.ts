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
 * @see {@link ProductRepositoryPort} for product persistence
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  coverImageUrl,
  PRODUCT_REPOSITORY_TOKEN,
  ProductRepositoryPort,
} from '@openlinker/core/products';
import type { Product } from '@openlinker/core/products';
import { INVENTORY_REPOSITORY_TOKEN } from '../../inventory.tokens';
import { InventoryRepositoryPort } from '../../domain/ports/inventory-repository.port';
import type { InventoryItem } from '../../domain/entities/inventory-item.entity';
import type {
  InventoryFilters,
  InventoryPagination,
} from '../../domain/types/inventory.types';
import type {
  InventoryItemView,
  InventoryViewProduct,
  PaginatedInventoryView,
} from '../types/inventory-view.types';
import { IInventoryQueryService } from './inventory-query.service.interface';

@Injectable()
export class InventoryQueryService implements IInventoryQueryService {
  constructor(
    @Inject(INVENTORY_REPOSITORY_TOKEN)
    private readonly inventoryRepository: InventoryRepositoryPort,
    @Inject(PRODUCT_REPOSITORY_TOKEN)
    private readonly productRepository: ProductRepositoryPort,
  ) {}

  async listInventoryItems(
    filters: InventoryFilters,
    pagination: InventoryPagination,
  ): Promise<PaginatedInventoryView> {
    const { items, total } = await this.inventoryRepository.findMany(
      filters,
      pagination,
    );
    const productMap = await this.buildProductMap(items.map((i) => i.productId));
    return {
      items: items.map((item) => this.compose(item, productMap.get(item.productId) ?? null)),
      total,
    };
  }

  async getInventoryItem(id: string): Promise<InventoryItemView | null> {
    const item = await this.inventoryRepository.findById(id);
    if (!item) {
      return null;
    }
    const product = await this.productRepository.findById(item.productId);
    return this.compose(item, product);
  }

  // TODO: Replace with a single findByIds(ids) call once ProductRepositoryPort supports batch lookup.
  // Current implementation issues N individual findById calls (one per unique productId).
  // For typical page sizes (≤20 items) this is acceptable, but a batch method would be more efficient.
  private async buildProductMap(productIds: string[]): Promise<Map<string, Product>> {
    const uniqueIds = [...new Set(productIds)];
    const products = await Promise.all(
      uniqueIds.map((id) => this.productRepository.findById(id)),
    );
    const map = new Map<string, Product>();
    uniqueIds.forEach((id, idx) => {
      const product = products[idx];
      if (product) {
        map.set(id, product);
      }
    });
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
