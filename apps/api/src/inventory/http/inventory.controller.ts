/**
 * Inventory Controller
 *
 * HTTP REST API endpoints for inventory read operations. Provides endpoints
 * for listing inventory items with filters and retrieving individual items.
 *
 * @module apps/api/src/inventory/http
 */
import {
  Controller,
  Get,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  InventoryRepositoryPort,
  INVENTORY_REPOSITORY_TOKEN,
  InventoryItemEntity as InventoryItem,
} from '@openlinker/core/inventory';
import {
  ProductRepositoryPort,
  PRODUCT_REPOSITORY_TOKEN,
  ProductEntity as Product,
} from '@openlinker/core/products';
import { ListInventoryQueryDto } from './dto/list-inventory-query.dto';
import { InventoryItemResponseDto } from './dto/inventory-item-response.dto';
import { PaginatedInventoryResponseDto } from './dto/paginated-inventory-response.dto';

@Roles('admin')
@ApiBearerAuth()
@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(
    @Inject(INVENTORY_REPOSITORY_TOKEN)
    private readonly inventoryRepository: InventoryRepositoryPort,
    @Inject(PRODUCT_REPOSITORY_TOKEN)
    private readonly productRepository: ProductRepositoryPort,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List inventory items',
    description:
      'Returns a paginated list of inventory items. Supports filtering by productId, productVariantId, and locationId.',
  })
  @ApiResponse({ status: 200, description: 'Paginated inventory list', type: PaginatedInventoryResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async listInventory(@Query() query: ListInventoryQueryDto): Promise<PaginatedInventoryResponseDto> {
    const { productId, productVariantId, locationId, limit = 20, offset = 0 } = query;

    const { items, total } = await this.inventoryRepository.findMany(
      { productId, productVariantId, locationId },
      { limit, offset },
    );

    const productMap = await this.buildProductMap(items.map((i) => i.productId));

    return {
      items: items.map((item) => this.toDto(item, productMap.get(item.productId))),
      total,
      limit,
      offset,
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get inventory item by ID' })
  @ApiResponse({ status: 200, description: 'Inventory item detail', type: InventoryItemResponseDto })
  @ApiResponse({ status: 404, description: 'Inventory item not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getInventoryItem(@Param('id') id: string): Promise<InventoryItemResponseDto> {
    const item = await this.inventoryRepository.findById(id);
    if (!item) {
      throw new NotFoundException(`Inventory item not found: ${id}`);
    }
    const product = await this.productRepository.findById(item.productId);
    return this.toDto(item, product);
  }

  // TODO: Replace with a single findByIds(ids) call once ProductRepositoryPort supports batch lookup.
  // Current implementation issues N individual findById calls (one per unique productId).
  // For typical page sizes (≤20 items) this is acceptable, but a batch method would be more efficient.
  private async buildProductMap(productIds: string[]): Promise<Map<string, Product>> {
    const uniqueIds = [...new Set(productIds)];
    const products = await Promise.all(uniqueIds.map((id) => this.productRepository.findById(id)));
    const map = new Map<string, Product>();
    uniqueIds.forEach((id, idx) => {
      const product = products[idx];
      if (product) {
        map.set(id, product);
      }
    });
    return map;
  }

  private toDto(item: InventoryItem, product?: Product | null): InventoryItemResponseDto {
    return {
      id: item.id,
      productId: item.productId,
      productVariantId: item.productVariantId,
      availableQuantity: item.availableQuantity,
      reservedQuantity: item.reservedQuantity,
      locationId: item.locationId,
      updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : item.updatedAt,
      productName: product?.name ?? null,
      productSku: product?.sku ?? null,
      // Cover-image rule lives on the Product entity (`coverImageUrl` getter);
      // the inventory layer does not replicate it.
      productImageUrl: product?.coverImageUrl ?? null,
    };
  }
}
