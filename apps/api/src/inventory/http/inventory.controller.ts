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
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Query,
} from '@nestjs/common';
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
import { ProvenanceBackfillStatusResponseDto } from './dto/provenance-backfill-status-response.dto';
import { GetStockViewQueryDto } from './dto/get-stock-view-query.dto';
import { StockViewResponseDto } from './dto/stock-view-response.dto';
import {
  StockViewProductNotFoundError,
  StockViewService,
  type ProductStockView,
} from '../application/services/stock-view.service';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AnyRole } from '../../auth/decorators/any-role.decorator';

@ApiBearerAuth()
@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(
    @Inject(INVENTORY_QUERY_SERVICE_TOKEN)
    private readonly queryService: IInventoryQueryService,
    private readonly stockView: StockViewService
  ) {}

  @AnyRole()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List inventory items',
    description:
      'Returns a paginated list of inventory items. Supports filtering by productId, productVariantId, and locationId, and excludeStale=true to leave out stale rows.',
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
    const { productId, productVariantId, locationId, excludeStale, limit = 20, offset = 0 } = query;

    const { items, total } = await this.queryService.listInventoryItems(
      { productId, productVariantId, locationId, excludeStale },
      { limit, offset }
    );

    return {
      items: items.map((view) => this.inventoryViewToDto(view)),
      total,
      limit,
      offset,
    };
  }

  @AnyRole()
  @Get('availability')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Batch lookup of per-variant inventory availability (#792)',
    description:
      'Returns one row per requested productVariantId with availableQuantity summed across all locations. ' +
      'Zero-filled for variants that have no inventory rows. Capped at 200 IDs per request. ' +
      'Each row also carries availableToPromise (#2321) — the computed quantity that may be promised, ' +
      'net of published reservation holds, answered in the GLOBAL scope: NO per-channel stock safety ' +
      'buffer or zero threshold is applied (a channel figure is on GET /inventory/stock-view). A null ' +
      'availableToPromise means OpenLinker could not resolve it and is NOT a zero. Rows also carry ' +
      'provenance, observedAt / stalenessMs / isStaleSync, the held split (heldCounted reduces the promise, ' +
      'heldRecordedOnly restricts nothing) and livePositionCount (#3621).',
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
    // Two reads, one source for the promise: `totalAvailable` / `locationCount`
    // keep their pre-#3621 meaning from the legacy read, while every figure the
    // operator reads as ONE statement (promise, provenance, holds, freshness)
    // comes from the stock view, so they cannot disagree with each other.
    const [items, views] = await Promise.all([
      this.queryService.getAvailabilityByVariantIds(query.productVariantIds),
      this.stockView.getVariantStockViews(query.productVariantIds),
    ]);
    const viewById = new Map(views.map((v) => [v.productVariantId, v]));
    return {
      items: items.map((i) => {
        const view = viewById.get(i.productVariantId);
        return {
          productVariantId: i.productVariantId,
          totalAvailable: i.totalAvailable,
          locationCount: i.locationCount,
          availableToPromise: view?.availableToPromise ?? null,
          provenance: view?.provenance ?? 'unknown',
          observedAt: view?.observedAt?.toISOString() ?? null,
          stalenessMs: view?.stalenessMs ?? null,
          isStaleSync: view?.isStaleSync ?? false,
          olHeldNotReflected: view?.olHeldNotReflected ?? null,
          heldCounted: view?.heldCounted ?? null,
          heldRecordedOnly: view?.heldRecordedOnly ?? null,
          livePositionCount: view?.livePositionCount ?? 0,
        };
      }),
    };
  }

  @Get('stock-view')
  @Roles('admin', 'operator', 'viewer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stock view of one product, per variant (#3621)',
    description:
      'The operator\'s stock panel in one read: per variant the master\'s stock and its own reserved units, ' +
      'the global-scope available to promise with its provenance, the advisory-hold split, every position ' +
      '(stale ones flagged), the newest live holds, a stale-sync flag against the operator-set threshold, and ' +
      'per channel the rule, the figure that WILL be published and what the marketplace last REPORTED. ' +
      'Nothing is invented: unknown stays null (provenance `unknown`), never 0.',
  })
  @ApiResponse({ status: 200, description: 'Stock view', type: StockViewResponseDto })
  @ApiResponse({ status: 404, description: 'Unknown product' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getStockView(@Query() query: GetStockViewQueryDto): Promise<StockViewResponseDto> {
    let view: ProductStockView;
    try {
      view = await this.stockView.getProductStockView(query.productId);
    } catch (error) {
      if (error instanceof StockViewProductNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
    return {
      productId: view.productId,
      productName: view.productName,
      productSku: view.productSku,
      staleSyncThreshold: { ...view.staleSyncThreshold },
      channelsStatus: view.channelsStatus,
      variants: view.variants.map((v) => ({
        productVariantId: v.productVariantId,
        sku: v.sku,
        attributes: { ...v.attributes },
        masterAvailable: v.masterAvailable,
        masterReserved: v.masterReserved,
        availableToPromise: v.availableToPromise,
        provenance: v.provenance,
        observedAt: v.observedAt?.toISOString() ?? null,
        stalenessMs: v.stalenessMs,
        olHeldNotReflected: v.olHeldNotReflected,
        heldCounted: v.heldCounted,
        heldRecordedOnly: v.heldRecordedOnly,
        livePositionCount: v.livePositionCount,
        isStaleSync: v.isStaleSync,
        positions: v.positions.map((p) => ({
          locationId: p.locationId,
          locationName: p.locationName,
          sourceConnectionId: p.sourceConnectionId,
          sourceConnectionName: p.sourceConnectionName,
          isStale: p.isStale,
          availableQuantity: p.availableQuantity,
          reservedQuantity: p.reservedQuantity,
          updatedAt: p.updatedAt.toISOString(),
        })),
        holds:
          v.holds === null
            ? null
            : v.holds.map((h) => ({
                orderRecordId: h.orderRecordId,
                orderNumber: h.orderNumber,
                quantity: h.quantity,
                atpEffect: h.atpEffect,
                expiresAt: h.expiresAt.toISOString(),
              })),
        channels: v.channels.map((c) => ({
          connectionId: c.connectionId,
          connectionName: c.connectionName,
          platformType: c.platformType,
          rule: c.rule ? { ...c.rule } : null,
          willPublish: { ...c.willPublish },
          channelShows: {
            quantity: c.channelShows.quantity,
            observedAt: c.channelShows.observedAt?.toISOString() ?? null,
          },
        })),
      })),
      generatedAt: new Date().toISOString(),
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
        productName: group.productName,
        sku: group.sku,
        connectionName: group.connectionName,
        locationName: group.locationName,
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

  @Get('provenance-backfill-status')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Live status of the #2317 provenance backfill',
    description:
      'The second, independent readiness condition for the #2325 SET NOT NULL ' +
      'migration alongside GET /inventory/duplicate-positions groupCount. Always ' +
      'resolved live — never cached.',
  })
  @ApiResponse({
    status: 200,
    description: 'Provenance backfill status',
    type: ProvenanceBackfillStatusResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions (admin only)' })
  async getProvenanceBackfillStatus(): Promise<ProvenanceBackfillStatusResponseDto> {
    return this.queryService.getProvenanceBackfillStatus();
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
      sourceConnectionId: item.sourceConnectionId,
      isStale: item.isStale,
      productName: product?.name ?? null,
      productSku: product?.sku ?? null,
      productImageUrl: product?.coverImageUrl ?? null,
    };
  }
}
