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
  Post,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  Inject,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  OrderRecordRepositoryPort,
  ORDER_RECORD_REPOSITORY_TOKEN,
  ORDER_DESTINATION_RETRY_SERVICE_TOKEN,
  OrderRecordNotFoundException,
  OrderDestinationNotFoundException,
  OrderDestinationNotRetryableException,
  MissingSourceExternalIdException,
  IOrderDestinationRetryService,
} from '@openlinker/core/orders';
import type { OrderRecord, OrderSyncStatus, SyncAttempt } from '@openlinker/core/orders';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { OrderHealthSummaryQueryDto } from './dto/order-health-summary-query.dto';
import { OrderHealthSummaryResponseDto } from './dto/order-health-summary-response.dto';
import { OrderRecordResponseDto } from './dto/order-record-response.dto';
import type { OrderSyncStatusResponseDto } from './dto/order-sync-status-response.dto';
import type { SyncAttemptResponseDto } from './dto/sync-attempt-response.dto';
import { PaginatedOrdersResponseDto } from './dto/paginated-orders-response.dto';
import { RetryOrderDestinationResponseDto } from './dto/retry-order-destination-response.dto';

@Roles('admin')
@ApiBearerAuth()
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly orderRecordRepository: OrderRecordRepositoryPort,
    @Inject(ORDER_DESTINATION_RETRY_SERVICE_TOKEN)
    private readonly destinationRetryService: IOrderDestinationRetryService
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List order records',
    description:
      'Returns a paginated list of order records. Supports filtering by sourceConnectionId, syncStatus, customerId, and date range.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated order list',
    type: PaginatedOrdersResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async listOrders(@Query() query: ListOrdersQueryDto): Promise<PaginatedOrdersResponseDto> {
    const {
      sourceConnectionId,
      syncStatus,
      customerId,
      createdFrom,
      createdTo,
      recordStatus,
      health,
      limit = 20,
      offset = 0,
    } = query;

    const { items, total } = await this.orderRecordRepository.findMany(
      {
        sourceConnectionId,
        syncStatus,
        customerId,
        createdFrom: createdFrom ? new Date(createdFrom) : undefined,
        createdTo: createdTo ? new Date(createdTo) : undefined,
        recordStatus,
        health,
      },
      { limit, offset }
    );

    return {
      items: items.map((order) => this.toDto(order)),
      total,
      limit,
      offset,
    };
  }

  @Get('status-summary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Order health summary counts',
    description:
      'Returns the count of order records per derived-health bucket (awaiting_mapping | needs_attention | synced | awaiting_dispatch) for the given source/customer/date scope. The four buckets partition the set, so `total` equals their sum — backs the list-page status segments.',
  })
  @ApiResponse({
    status: 200,
    description: 'Per-health-bucket counts',
    type: OrderHealthSummaryResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async statusSummary(
    @Query() query: OrderHealthSummaryQueryDto
  ): Promise<OrderHealthSummaryResponseDto> {
    const { sourceConnectionId, customerId, createdFrom, createdTo } = query;
    return this.orderRecordRepository.countByHealth({
      sourceConnectionId,
      customerId,
      createdFrom: createdFrom ? new Date(createdFrom) : undefined,
      createdTo: createdTo ? new Date(createdTo) : undefined,
    });
  }

  @Get(':internalOrderId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get order record by internal order ID' })
  @ApiResponse({ status: 200, description: 'Order record detail', type: OrderRecordResponseDto })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getOrder(
    @Param('internalOrderId') internalOrderId: string
  ): Promise<OrderRecordResponseDto> {
    const order = await this.orderRecordRepository.findById(internalOrderId);
    if (!order) {
      throw new NotFoundException(`Order not found: ${internalOrderId}`);
    }
    return this.toDto(order);
  }

  @Post(':internalOrderId/destinations/:connectionId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Retry a failed destination sync for an order',
    description:
      'Re-enqueues the source-side `marketplace.order.sync` job with a fresh idempotency key. Only destinations whose current status is `failed` can be retried — `pending` / `syncing` / `synced` rows are rejected with 409. The destination row is flipped to `pending` immediately so the operator sees the retry queued.',
  })
  @ApiResponse({
    status: 202,
    description: 'Retry accepted; new sync job enqueued',
    type: RetryOrderDestinationResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Order or destination row not found' })
  @ApiResponse({ status: 409, description: 'Destination is not in a retryable state' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async retryDestination(
    @Param('internalOrderId') internalOrderId: string,
    @Param('connectionId', ParseUUIDPipe) connectionId: string
  ): Promise<RetryOrderDestinationResponseDto> {
    try {
      const result = await this.destinationRetryService.retry({
        internalOrderId,
        destinationConnectionId: connectionId,
      });
      return {
        internalOrderId,
        destinationConnectionId: connectionId,
        jobId: result.jobId,
        jobType: result.jobType,
      };
    } catch (error) {
      if (
        error instanceof OrderRecordNotFoundException ||
        error instanceof OrderDestinationNotFoundException
      ) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof OrderDestinationNotRetryableException) {
        throw new ConflictException(error.message);
      }
      if (error instanceof MissingSourceExternalIdException) {
        throw new InternalServerErrorException(error.message);
      }
      throw error;
    }
  }

  private toDto(order: OrderRecord): OrderRecordResponseDto {
    return {
      internalOrderId: order.internalOrderId,
      customerId: order.customerId,
      sourceConnectionId: order.sourceConnectionId,
      sourceEventId: order.sourceEventId,
      orderSnapshot: order.orderSnapshot,
      syncStatus: order.syncStatus.map((s) => this.toSyncStatusDto(s)),
      syncAttempts: order.syncAttempts.map((a) => this.toSyncAttemptDto(a)),
      recordStatus: order.recordStatus,
      createdAt: order.createdAt instanceof Date ? order.createdAt.toISOString() : order.createdAt,
      updatedAt: order.updatedAt instanceof Date ? order.updatedAt.toISOString() : order.updatedAt,
    };
  }

  private toSyncStatusDto(s: OrderSyncStatus): OrderSyncStatusResponseDto {
    return {
      destinationConnectionId: s.destinationConnectionId,
      status: s.status,
      syncedAt: s.syncedAt instanceof Date ? s.syncedAt.toISOString() : s.syncedAt ?? null,
      externalOrderId: s.externalOrderId ?? null,
      externalOrderNumber: s.externalOrderNumber ?? null,
      error: s.error ?? null,
    };
  }

  private toSyncAttemptDto(a: SyncAttempt): SyncAttemptResponseDto {
    return {
      destinationConnectionId: a.destinationConnectionId,
      status: a.status,
      attemptedAt: a.attemptedAt instanceof Date ? a.attemptedAt.toISOString() : a.attemptedAt,
      error: a.error ?? null,
      externalOrderId: a.externalOrderId ?? null,
      externalOrderNumber: a.externalOrderNumber ?? null,
    };
  }
}
