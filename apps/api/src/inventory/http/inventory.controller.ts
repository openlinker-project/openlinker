/**
 * Inventory Controller
 *
 * HTTP REST API endpoints for inventory read operations. Delegates the
 * cross-aggregate composition of inventory items with master-catalog product
 * details to IInventoryQueryService; keeps only transport concerns (pagination
 * echo, date serialisation, HTTP 404 translation).
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
import type { InventoryItemView } from '@openlinker/core/inventory';
import { IInventoryQueryService, INVENTORY_QUERY_SERVICE_TOKEN } from '@openlinker/core/inventory';
import { ListInventoryQueryDto } from './dto/list-inventory-query.dto';
import { InventoryItemResponseDto } from './dto/inventory-item-response.dto';
import { PaginatedInventoryResponseDto } from './dto/paginated-inventory-response.dto';

@Roles('admin')
@ApiBearerAuth()
@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(
    @Inject(INVENTORY_QUERY_SERVICE_TOKEN)
    private readonly queryService: IInventoryQueryService
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List inventory items',
    description:
      'Returns a paginated list of inventory items. Supports filtering by productId, productVariantId, and locationId.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated inventory list',
    type: PaginatedInventoryResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async listInventory(
    @Query() query: ListInventoryQueryDto
  ): Promise<PaginatedInventoryResponseDto> {
    const { productId, productVariantId, locationId, limit = 20, offset = 0 } = query;

    const { items, total } = await this.queryService.listInventoryItems(
      { productId, productVariantId, locationId },
      { limit, offset }
    );

    return {
      items: items.map((view) => this.inventoryViewToDto(view)),
      total,
      limit,
      offset,
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get inventory item by ID' })
  @ApiResponse({
    status: 200,
    description: 'Inventory item detail',
    type: InventoryItemResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Inventory item not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getInventoryItem(@Param('id') id: string): Promise<InventoryItemResponseDto> {
    const view = await this.queryService.getInventoryItem(id);
    if (!view) {
      throw new NotFoundException(`Inventory item not found: ${id}`);
    }
    return this.inventoryViewToDto(view);
  }

  private inventoryViewToDto(view: InventoryItemView): InventoryItemResponseDto {
    const { item, product } = view;
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
      productImageUrl: product?.coverImageUrl ?? null,
    };
  }
}
