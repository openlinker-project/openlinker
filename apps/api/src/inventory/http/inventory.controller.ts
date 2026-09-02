/**
 * Inventory Controller
 *
 * HTTP REST API endpoints for inventory read operations. Delegates the
 * cross-aggregate composition of inventory items with master-catalog product
 * details to IInventoryQueryService; keeps only transport concerns (pagination
 * echo, date serialisation).
 *
 * @module apps/api/src/inventory/http
 */
import { Controller, Get, Query, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { InventoryItemView } from '@openlinker/core/inventory';
import { IInventoryQueryService, INVENTORY_QUERY_SERVICE_TOKEN } from '@openlinker/core/inventory';
import { ListInventoryQueryDto } from './dto/list-inventory-query.dto';
import type { InventoryItemResponseDto } from './dto/inventory-item-response.dto';
import { PaginatedInventoryResponseDto } from './dto/paginated-inventory-response.dto';
import { GetInventoryAvailabilityQueryDto } from './dto/get-inventory-availability-query.dto';
import { InventoryAvailabilityResponseDto } from './dto/inventory-availability-response.dto';
import { GetDuplicatePositionsQueryDto } from './dto/get-duplicate-positions-query.dto';
import { DuplicatePositionsResponseDto } from './dto/duplicate-positions-response.dto';
import { Roles } from '../../auth/decorators/roles.decorator';

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

  @Get('availability')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Batch lookup of per-variant inventory availability (#792)',
    description:
      'Returns one row per requested productVariantId with availableQuantity summed across all locations. ' +
      'Zero-filled for variants that have no inventory rows. Capped at 200 IDs per request. ' +
      'Each row also carries availableToPromise (#2321) — the computed quantity that may be promised, ' +
      'net of published reservation holds and the destination stock safety buffer. A null ' +
      'availableToPromise means OpenLinker could not resolve it and is NOT a zero.',
  })
  @ApiResponse({
    status: 200,
    description: 'Per-variant availability',
    type: InventoryAvailabilityResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Empty or oversize productVariantIds list' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getAvailability(
    @Query() query: GetInventoryAvailabilityQueryDto
  ): Promise<InventoryAvailabilityResponseDto> {
    const items = await this.queryService.getAvailabilityByVariantIds(query.productVariantIds);
    return {
      items: items.map((i) => ({
        productVariantId: i.productVariantId,
        totalAvailable: i.totalAvailable,
        locationCount: i.locationCount,
        availableToPromise: i.availableToPromise,
      })),
    };
  }

  @Get('duplicate-positions')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Report duplicate inventory positions (#2319)',
    description:
      'READ-ONLY operator diagnostic — detects, never repairs, and writes nothing. Groups every ' +
      'inventory_items row by the four-column position key (productId, productVariantId, ' +
      'locationId, sourceConnectionId) and reports the keys holding more than one row. ' +
      'Provenance is part of the key because ADR-058 decision (2) makes cross-source coexistence ' +
      'legitimate. Stale rows are included, because a stale duplicate still collides under the ' +
      'unique index ADR-058 ladder step (iii) / #2325 creates. groupCount is the UNCAPPED ' +
      'readiness gate for that step: 0 means the index can be built. Remediation is manual — see ' +
      'docs/operations/inventory-duplicate-positions.md.',
  })
  @ApiResponse({
    status: 200,
    description: 'Duplicate-position report',
    type: DuplicatePositionsResponseDto,
  })
  @ApiResponse({ status: 400, description: 'maxGroups out of range' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions (admin only)' })
  async getDuplicatePositions(
    @Query() query: GetDuplicatePositionsQueryDto
  ): Promise<DuplicatePositionsResponseDto> {
    const report = await this.queryService.getDuplicatePositionReport(query.maxGroups);
    return {
      groupCount: report.groupCount,
      rowCount: report.rowCount,
      excessRowCount: report.excessRowCount,
      truncated: report.truncated,
      groups: report.groups.map((group) => ({
        productId: group.productId,
        productVariantId: group.productVariantId,
        locationId: group.locationId,
        sourceConnectionId: group.sourceConnectionId,
        rowCount: group.rowCount,
        liveRowCount: group.liveRowCount,
        rows: group.rows.map((row) => ({
          id: row.id,
          availableQuantity: row.availableQuantity,
          reservedQuantity: row.reservedQuantity,
          isStale: row.isStale,
          updatedAt:
            row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
        })),
      })),
      // Stamped at the transport boundary: the report is a point-in-time scan,
      // and an operator re-running it after remediation needs to tell the two
      // answers apart.
      generatedAt: new Date().toISOString(),
    };
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
