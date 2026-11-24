/**
 * Inventory Movements Controller (#3565)
 *
 * `GET /inventory/movements` - the stock movement history: ledger rows plus
 * reservations as "Promised" rows. Read-only; the ledger is written inside
 * `IInventoryService.setInventory`, never through HTTP.
 *
 * @module apps/api/src/inventory/http
 */
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  INVENTORY_MOVEMENT_SERVICE_TOKEN,
  type IInventoryMovementService,
  type InventoryHistoryRow,
  type InventoryMovementFilters,
} from '@openlinker/core/inventory';
import { ORDER_RECORD_SERVICE_TOKEN, type IOrderRecordService } from '@openlinker/core/orders';
import { PROMOTION_SERVICE_TOKEN, type IPromotionService } from '@openlinker/core/promotions';
import {
  USER_MANAGEMENT_SERVICE_TOKEN,
  type IUserManagementService,
} from '../../users/user-management.service.interface';
import { PaginatedTotalResponseDto } from '../../common/dto/paginated-total-response.dto';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  InventoryMovementGiftResponseDto,
  PaginatedInventoryMovementsResponseDto,
  toInventoryMovementResponseDto,
} from './dto/inventory-movement-response.dto';
import {
  ListInventoryMovementsQueryDto,
  MovementFiltersQueryDto,
} from './dto/list-inventory-movements-query.dto';
import {
  ChannelQuantityPushesResponseDto,
  toChannelQuantityPushResponseDto,
} from './dto/channel-quantity-push-response.dto';
import { codedHttpError } from '../../common/errors/coded-http.exception';

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
    private readonly users: IUserManagementService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orders: IOrderRecordService,
    @Inject(PROMOTION_SERVICE_TOKEN)
    private readonly promotions: IPromotionService
  ) {}

  /**
   * Where each gift movement came from (#3935), read off the order's gift line.
   * Best-effort: a failed read leaves the rows without a source instead of
   * failing the history, which is read-only evidence and re-readable.
   */
  private async giftSources(
    rows: readonly InventoryHistoryRow[]
  ): Promise<Map<string, InventoryMovementGiftResponseDto>> {
    const result = new Map<string, InventoryMovementGiftResponseDto>();
    // Movements that decrement a gift, and the reservations that set a gift aside
    // for an order (#3935): both read the same gift line of the same order.
    const giftRows = rows.filter(
      (row) =>
        row.sourceKind === 'order' &&
        row.sourceRef !== null &&
        (row.kind === 'reservation' || row.reason === 'gift' || row.reason === 'sale')
    );
    if (giftRows.length === 0) {
      return result;
    }
    try {
      const orderIds = [...new Set(giftRows.map((row) => row.sourceRef as string))];
      const [orders, promotions] = await Promise.all([
        this.orders.findByIds(orderIds),
        this.promotions.list(),
      ]);
      const orderById = new Map(orders.map((order) => [order.internalOrderId, order]));
      const nameById = new Map(promotions.map((view) => [view.promotion.id, view.promotion.name]));
      for (const row of giftRows) {
        const order = orderById.get(row.sourceRef as string);
        const items = order?.orderItems ?? [];
        const sameVariant = items.filter((item) => item.variantId === row.productVariantId);
        const gifts = sameVariant.filter((item) => item.gift !== undefined);
        // A reservation or a plain sale carries no gift reason: it is a gift only
        // when every line of that variant on the order is one, so a paid line is
        // never mislabelled.
        const declaredGift = row.reason === 'gift';
        const allGift = gifts.length > 0 && gifts.length === sameVariant.length;
        const line =
          declaredGift || allGift
            ? (gifts[0] ?? items.find((item) => item.gift !== undefined))
            : undefined;
        if (line?.gift !== undefined) {
          const ruleRef = line.gift.ruleRef ?? null;
          const dto = new InventoryMovementGiftResponseDto();
          dto.source = line.gift.source;
          dto.promotionId = line.gift.source === 'ol-rule' ? ruleRef : null;
          dto.promotionName = ruleRef === null ? null : (nameById.get(ruleRef) ?? null);
          dto.bundleName = null;
          result.set(row.id, dto);
          continue;
        }
        // The free gift of a bundle is a component, not a gift line of its own.
        for (const bundle of order?.bundleLines ?? []) {
          const slot = bundle.components.find(
            (component) => component.giftSlot === true && component.variantId === row.productVariantId
          );
          if (slot !== undefined && (declaredGift || sameVariant.length === 0)) {
            const dto = new InventoryMovementGiftResponseDto();
            dto.source = 'bundle-slot';
            dto.promotionId = null;
            dto.promotionName = null;
            dto.bundleName = items.find((item) => item.id === bundle.lineId)?.name ?? null;
            result.set(row.id, dto);
            break;
          }
        }
      }
    } catch {
      // Evidence only; see the method note.
    }
    return result;
  }

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
    const gifts = await this.giftSources(rows);
    const items = rows.map((row) => toInventoryMovementResponseDto(row, actorNames, gifts));

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

  @Roles('admin', 'operator', 'viewer')
  @Get(':movementId/pushes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'What OpenLinker sent each channel for one stock movement (#4062)',
    description:
      'The quantity writes that expressed this movement, oldest first. An empty list means ' +
      'nothing was sent: the change was refused, the variant is listed nowhere, or the movement ' +
      'is a reservation.',
  })
  @ApiResponse({ status: 200, type: ChannelQuantityPushesResponseDto })
  @ApiResponse({ status: 404, description: 'No movement with this id' })
  async listChannelPushes(
    @Param('movementId', new ParseUUIDPipe()) movementId: string
  ): Promise<ChannelQuantityPushesResponseDto> {
    const pushes = await this.movements.listChannelPushes(movementId);
    if (pushes === null) {
      throw codedHttpError(
        HttpStatus.NOT_FOUND,
        'STOCK_MOVEMENT_NOT_FOUND',
        `Stock movement ${movementId} not found`,
        { movementId }
      );
    }
    return { items: pushes.map(toChannelQuantityPushResponseDto) };
  }
}
