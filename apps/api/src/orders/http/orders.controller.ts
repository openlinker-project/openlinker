/**
 * Orders Controller
 *
 * HTTP REST API endpoints for order record read operations. Provides endpoints
 * for listing order records with filters and retrieving individual orders.
 *
 * @module apps/api/src/orders/http
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
  OrderRecordRepositoryPort,
  ORDER_RECORD_REPOSITORY_TOKEN,
} from '@openlinker/core/orders';
import type { OrderRecord, OrderSyncStatus } from '@openlinker/core/orders';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { OrderRecordResponseDto } from './dto/order-record-response.dto';
import { OrderSyncStatusResponseDto } from './dto/order-sync-status-response.dto';
import { PaginatedOrdersResponseDto } from './dto/paginated-orders-response.dto';

@Roles('admin')
@ApiBearerAuth()
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly orderRecordRepository: OrderRecordRepositoryPort,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List order records',
    description:
      'Returns a paginated list of order records. Supports filtering by sourceConnectionId, syncStatus, customerId, and date range.',
  })
  @ApiResponse({ status: 200, description: 'Paginated order list', type: PaginatedOrdersResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async listOrders(@Query() query: ListOrdersQueryDto): Promise<PaginatedOrdersResponseDto> {
    const { sourceConnectionId, syncStatus, customerId, createdFrom, createdTo, recordStatus, limit = 20, offset = 0 } = query;

    const { items, total } = await this.orderRecordRepository.findMany(
      {
        sourceConnectionId,
        syncStatus,
        customerId,
        createdFrom: createdFrom ? new Date(createdFrom) : undefined,
        createdTo: createdTo ? new Date(createdTo) : undefined,
        recordStatus,
      },
      { limit, offset },
    );

    return {
      items: items.map((order) => this.toDto(order)),
      total,
      limit,
      offset,
    };
  }

  @Get(':internalOrderId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get order record by internal order ID' })
  @ApiResponse({ status: 200, description: 'Order record detail', type: OrderRecordResponseDto })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getOrder(@Param('internalOrderId') internalOrderId: string): Promise<OrderRecordResponseDto> {
    const order = await this.orderRecordRepository.findById(internalOrderId);
    if (!order) {
      throw new NotFoundException(`Order not found: ${internalOrderId}`);
    }
    return this.toDto(order);
  }

  private toDto(order: OrderRecord): OrderRecordResponseDto {
    return {
      internalOrderId: order.internalOrderId,
      customerId: order.customerId,
      sourceConnectionId: order.sourceConnectionId,
      sourceEventId: order.sourceEventId,
      orderSnapshot: order.orderSnapshot,
      syncStatus: order.syncStatus.map((s) => this.toSyncStatusDto(s)),
      recordStatus: order.recordStatus,
      createdAt: order.createdAt instanceof Date ? order.createdAt.toISOString() : order.createdAt,
      updatedAt: order.updatedAt instanceof Date ? order.updatedAt.toISOString() : order.updatedAt,
    };
  }

  private toSyncStatusDto(s: OrderSyncStatus): OrderSyncStatusResponseDto {
    return {
      destinationConnectionId: s.destinationConnectionId,
      status: s.status,
      syncedAt: s.syncedAt instanceof Date ? s.syncedAt.toISOString() : (s.syncedAt ?? null),
      externalOrderId: s.externalOrderId ?? null,
      externalOrderNumber: s.externalOrderNumber ?? null,
      error: s.error ?? null,
    };
  }
}
