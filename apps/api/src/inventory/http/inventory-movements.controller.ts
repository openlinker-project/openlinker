/**
 * Inventory Movements Controller (#3565)
 *
 * `GET /inventory/movements` - the stock movement history: ledger rows plus
 * reservations as "Promised" rows. Read-only; the ledger is written inside
 * `IInventoryService.setInventory`, never through HTTP.
 *
 * @module apps/api/src/inventory/http
 */
import { Controller, Get, HttpCode, HttpStatus, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  INVENTORY_MOVEMENT_SERVICE_TOKEN,
  type IInventoryMovementService,
  type InventoryMovementFilters,
} from '@openlinker/core/inventory';
import {
  USER_MANAGEMENT_SERVICE_TOKEN,
  type IUserManagementService,
} from '../../users/user-management.service.interface';
import { PaginatedTotalResponseDto } from '../../common/dto/paginated-total-response.dto';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  PaginatedInventoryMovementsResponseDto,
  toInventoryMovementResponseDto,
} from './dto/inventory-movement-response.dto';
import {
  ListInventoryMovementsQueryDto,
  MovementFiltersQueryDto,
} from './dto/list-inventory-movements-query.dto';

function toFilters(query: MovementFiltersQueryDto): InventoryMovementFilters {
  return {
    productId: query.productId,
    productVariantId: query.productVariantId,
    reasons: query.reasons,
    sourceConnectionId: query.sourceConnectionId,
    from: query.from !== undefined ? new Date(query.from) : undefined,
    to: query.to !== undefined ? new Date(query.to) : undefined,
    needsAttention: query.needsAttention,
    kind: query.kind,
    search: query.search,
  };
}

@ApiBearerAuth()
@ApiTags('inventory')
@Controller('inventory/movements')
export class InventoryMovementsController {
  constructor(
    @Inject(INVENTORY_MOVEMENT_SERVICE_TOKEN)
    private readonly movements: IInventoryMovementService,
    @Inject(USER_MANAGEMENT_SERVICE_TOKEN)
    private readonly users: IUserManagementService
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stock movement history (#3565)',
    description:
      'Newest first. Each row is a stock movement or a reservation shown as "Promised" ' +
      '(a reservation changes what OpenLinker promises, never the stock - ADR-061). ' +
      'A refused movement changed nothing; an in-doubt one may have - its after-quantity is unknown. ' +
      'Set `?withTotal=false` to skip the count (the response then omits `total`; fetch it from ' +
      '`GET /inventory/movements/count`).',
  })
  @ApiResponse({ status: 200, type: PaginatedInventoryMovementsResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async listMovements(
    @Query() query: ListInventoryMovementsQueryDto
  ): Promise<PaginatedInventoryMovementsResponseDto> {
    const { withTotal, limit = 20, offset = 0 } = query;
    const filters = toFilters(query);
    const rows = await this.movements.listMovements(filters, { limit, offset });
    const actorIds = rows
      .map((row) => row.actorUserId)
      .filter((id): id is string => id !== null);
    const actorNames = actorIds.length > 0 ? await this.users.getDisplayNames(actorIds) : new Map<string, string>();
    const items = rows.map((row) => toInventoryMovementResponseDto(row, actorNames));

    // Two branches so the response object does not CARRY `total` when it was not
    // asked for: an absent total and a genuine zero are different claims.
    if (withTotal === false) {
      return { items, limit, offset };
    }
    return { items, total: await this.movements.countMovements(filters), limit, offset };
  }

  @Roles('admin', 'operator', 'viewer')
  @Get('count')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Count stock movement history rows (#3565)',
    description: 'The total behind GET /inventory/movements for the same filters.',
  })
  @ApiResponse({ status: 200, type: PaginatedTotalResponseDto })
  async countMovements(
    @Query() query: MovementFiltersQueryDto
  ): Promise<PaginatedTotalResponseDto> {
    return { total: await this.movements.countMovements(toFilters(query)) };
  }
}
