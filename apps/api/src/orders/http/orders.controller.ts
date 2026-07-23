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
  deriveSlaState,
} from '@openlinker/core/orders';
import type {
  OrderRecord,
  OrderSyncStatus,
  SyncAttempt,
} from '@openlinker/core/orders';
import {
  INVOICE_SERVICE_TOKEN,
  IInvoiceService,
} from '@openlinker/core/invoicing';
import type { InvoiceRecord } from '@openlinker/core/invoicing';
import {
  FULFILLMENT_ROUTING_SERVICE_TOKEN,
  IFulfillmentRoutingService,
  DELIVERY_RIDER_SERVICE_TOKEN,
  IDeliveryRiderService,
} from '@openlinker/core/mappings';
import type {
  FulfillmentRoutingResolution,
  DeliveryRiderInput,
  DeliveryRiderResolution,
} from '@openlinker/core/mappings';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { OrderHealthSummaryQueryDto } from './dto/order-health-summary-query.dto';
import { OrderHealthSummaryResponseDto } from './dto/order-health-summary-response.dto';
import { OrderSlaSummaryResponseDto } from './dto/order-sla-summary-response.dto';
import { OrderRecordResponseDto } from './dto/order-record-response.dto';
import type { OrderSyncStatusResponseDto } from './dto/order-sync-status-response.dto';
import type { SyncAttemptResponseDto } from './dto/sync-attempt-response.dto';
import { PaginatedOrdersResponseDto } from './dto/paginated-orders-response.dto';
import { RetryOrderDestinationResponseDto } from './dto/retry-order-destination-response.dto';
import type { OrderInvoiceProjectionDto } from './dto/order-invoice-projection.dto';
import type { OrderDeliveryResolutionDto } from './dto/order-delivery-resolution.dto';
import type { OrderDeliveryRiderDto } from './dto/order-delivery-rider.dto';

@ApiBearerAuth()
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly orderRecordRepository: OrderRecordRepositoryPort,
    @Inject(ORDER_DESTINATION_RETRY_SERVICE_TOKEN)
    private readonly destinationRetryService: IOrderDestinationRetryService,
    @Inject(INVOICE_SERVICE_TOKEN)
    private readonly invoiceService: IInvoiceService,
    @Inject(FULFILLMENT_ROUTING_SERVICE_TOKEN)
    private readonly fulfillmentRouting: IFulfillmentRoutingService,
    @Inject(DELIVERY_RIDER_SERVICE_TOKEN)
    private readonly deliveryRider: IDeliveryRiderService
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
      sort,
      dir,
      dueBefore,
      slaState,
      fulfillmentState,
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
        sort,
        dir,
        dueBefore: dueBefore ? new Date(dueBefore) : undefined,
        slaState,
        fulfillmentState,
      },
      { limit, offset }
    );

    // Batch the invoice projection for the whole page (#1713): one query, not an
    // N+1 of per-row `getLatestInvoiceForOrder`. Orders with no invoice are
    // absent from the map and simply carry no `invoice` sub-tree — the FE then
    // shows the "Issue invoice" action instead of a status pill.
    const invoices = await this.invoiceService.getLatestInvoicesForOrders(
      items.map((order) => order.internalOrderId)
    );
    const invoiceByOrderId = new Map(invoices.map((invoice) => [invoice.orderId, invoice]));

    // Batch the delivery-routing-resolution + rider projection for the whole
    // page (#1791/#1792): one `resolveBatch` per service (each collapsing to a
    // small, fixed number of reads — the rider's carrier-state read is
    // order-independent and happens once), not an N+1 of per-row calls. Only
    // orders that carry a source delivery method are queried; the rest simply
    // have no `deliveryResolution` / `deliveryRider` on their DTO.
    const deliveryByOrderId = await this.resolveDeliveryForOrders(items);

    return {
      items: items.map((order) => {
        const dto = this.toDto(order);
        const invoice = invoiceByOrderId.get(order.internalOrderId);
        if (invoice) {
          dto.orderSnapshot = { ...dto.orderSnapshot, invoice: this.toInvoiceProjection(invoice) };
        }
        const delivery = deliveryByOrderId.get(order.internalOrderId);
        if (delivery) {
          dto.deliveryResolution = delivery.resolution;
          dto.deliveryRider = delivery.rider;
        }
        return dto;
      }),
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

  @Get('sla-summary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Order ship-by SLA summary counts',
    description:
      'Returns the count of order records per ship-by SLA bucket (none | on_track | at_risk | overdue) for the given source/customer/date scope. The buckets partition the set, so `total` equals their sum — backs the list-page SLA KPI cells (#1108).',
  })
  @ApiResponse({
    status: 200,
    description: 'Per-SLA-bucket counts',
    type: OrderSlaSummaryResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async slaSummary(
    @Query() query: OrderHealthSummaryQueryDto
  ): Promise<OrderSlaSummaryResponseDto> {
    const { sourceConnectionId, customerId, createdFrom, createdTo } = query;
    return this.orderRecordRepository.countBySla({
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
    const dto = this.toDto(order);
    // Invoice projection (#1224): the FE invoice panel reads a neutral `invoice`
    // sub-tree off the snapshot. The list endpoint now shares the same projection
    // via a batch read (`getLatestInvoicesForOrders`, one query per page — #1713);
    // this detail read joins the single record for one order.
    const invoiceRecord = await this.invoiceService.getLatestInvoiceForOrder(
      order.internalOrderId
    );
    if (invoiceRecord) {
      dto.orderSnapshot = { ...dto.orderSnapshot, invoice: this.toInvoiceProjection(invoiceRecord) };
    }
    // Delivery-routing-resolution + rider projection (#1791/#1792): a
    // single-order counterpart to the list read's batched resolution below.
    // Absent when the order carries no source delivery method — resolving would
    // just echo the omp_fulfilled default with no delivery method to route.
    if (order.sourceDeliveryMethodId) {
      const resolution = await this.fulfillmentRouting.resolve({
        sourceConnectionId: order.sourceConnectionId,
        sourceDeliveryMethodId: order.sourceDeliveryMethodId,
      });
      dto.deliveryResolution = this.toDeliveryResolutionDto(resolution);
      dto.deliveryRider = this.toDeliveryRiderDto(
        await this.deliveryRider.resolve(this.toRiderInput(order, resolution))
      );
    }
    return dto;
  }

  @Roles('admin', 'operator')
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
    const fulfillmentState = order.fulfillmentState ?? 'not-shipped';
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
      dispatchByAt: order.dispatchByAt ? order.dispatchByAt.toISOString() : null,
      // Ship-by estimate flag (#1776): a typed, fail-safe read off the snapshot's
      // dispatch window. Erli marks its derived window `estimated: true`; Allegro
      // leaves it absent (authoritative). Narrowing lives on the entity getter.
      dispatchByEstimated: order.dispatchByEstimated,
      fulfillmentState,
      // BE-owned SLA bucket (#1108): single source of truth so the list filter +
      // badge agree. The FE renders only the live countdown off dispatchByAt.
      slaState: deriveSlaState(order.dispatchByAt, order.fulfillmentState, new Date()),
      // Typed projection of the source delivery method (#1791/#1792) so the
      // #1794 Add-mapping deep link reads named fields, not the untyped
      // orderSnapshot blob. Read off the OrderRecord getters; null when absent.
      sourceDeliveryMethodId: order.sourceDeliveryMethodId,
      sourceDeliveryMethodName: order.sourceDeliveryMethodName,
    };
  }

  /**
   * Neutral invoice projection (#1224, ADR-026) merged into the order-detail
   * snapshot. `invoiceId` is the internal record id the UPO download endpoint
   * keys on; `confirmationDocumentAvailable` is true only when the invoice
   * is cleared (`regulatoryStatus === 'accepted'`) — it gates the FE download
   * action. No regime/provider vocabulary crosses here.
   */
  private toInvoiceProjection(record: InvoiceRecord): OrderInvoiceProjectionDto {
    const confirmationDocumentAvailable = record.status === 'issued' && record.regulatoryStatus === 'accepted';
    return {
      invoiceId: record.id,
      documentType: record.documentType,
      status: record.status,
      regulatoryStatus: record.regulatoryStatus,
      clearanceReference: record.clearanceReference,
      confirmationDocumentAvailable,
    };
  }

  /**
   * Batched delivery-routing resolution for a page of orders (#1791). Queries
   * `IFulfillmentRoutingService.resolveBatch` once for every order that
   * carries a source delivery method (`OrderRecord.sourceDeliveryMethodId`,
   * the same key the shipping dispatch seam resolves against) — the service
   * itself further collapses that into one repository read per distinct
   * `sourceConnectionId`, so this stays a small, fixed number of DB round
   * trips regardless of page size, not an N+1 per order.
   */
  private async resolveDeliveryForOrders(
    orders: OrderRecord[]
  ): Promise<
    Map<string, { resolution: OrderDeliveryResolutionDto; rider: OrderDeliveryRiderDto }>
  > {
    const ordersWithMethod = orders.filter(
      (order): order is OrderRecord & { sourceDeliveryMethodId: string } =>
        order.sourceDeliveryMethodId !== null
    );
    if (ordersWithMethod.length === 0) {
      return new Map();
    }
    const resolutions = await this.fulfillmentRouting.resolveBatch(
      ordersWithMethod.map((order) => ({
        sourceConnectionId: order.sourceConnectionId,
        sourceDeliveryMethodId: order.sourceDeliveryMethodId,
      }))
    );
    // Rider inputs carry each order's resolution `source` (#1791) — the rider
    // only fires on `default`. The service reads carrier state once for the
    // whole batch (it is order-independent), so this stays cheap.
    const riders = await this.deliveryRider.resolveBatch(
      ordersWithMethod.map((order, i) => this.toRiderInput(order, resolutions[i]))
    );
    return new Map(
      ordersWithMethod.map((order, i) => [
        order.internalOrderId,
        {
          resolution: this.toDeliveryResolutionDto(resolutions[i]),
          rider: this.toDeliveryRiderDto(riders[i]),
        },
      ])
    );
  }

  private toDeliveryResolutionDto(
    resolution: FulfillmentRoutingResolution
  ): OrderDeliveryResolutionDto {
    return {
      source: resolution.source,
      processorKind: resolution.processorKind,
      processorConnectionId: resolution.processorConnectionId,
      processorAvailable: resolution.processorAvailable,
    };
  }

  /**
   * Build the delivery-rider input (#1792) from an order + its #1791 routing
   * resolution. The rider's `resolutionSource` is the resolution's `source`, so
   * a live `rule`-resolved order short-circuits to `none` inside the service;
   * `routedProcessorDisabled` (#1799) flags a `rule` whose processor connection
   * is not active, driving the `disabled` (*Enable {carrier}*) rider.
   */
  private toRiderInput(
    order: OrderRecord,
    resolution: FulfillmentRoutingResolution
  ): DeliveryRiderInput {
    return {
      sourceConnectionId: order.sourceConnectionId,
      sourceDeliveryMethod: {
        name: order.sourceDeliveryMethodName,
        typeId: order.sourceDeliveryMethodId,
      },
      resolutionSource: resolution.source,
      routedProcessorDisabled: resolution.source === 'rule' && !resolution.processorAvailable,
    };
  }

  private toDeliveryRiderDto(rider: DeliveryRiderResolution): OrderDeliveryRiderDto {
    return {
      rider: rider.rider,
      ...(rider.candidateCarrier ? { candidateCarrier: rider.candidateCarrier } : {}),
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
