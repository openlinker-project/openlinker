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
  Delete,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Inject,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import {
  OrderRecordRepositoryPort,
  ORDER_RECORD_REPOSITORY_TOKEN,
  ORDER_DESTINATION_RETRY_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  IOrderRecordService,
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
import {
  deriveOrderLifecyclePhase,
  DEFAULT_LIFECYCLE_AUTHORITY,
} from '@openlinker/core/order-lifecycle';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { OrderHealthSummaryQueryDto } from './dto/order-health-summary-query.dto';
import { OrderHealthSummaryResponseDto } from './dto/order-health-summary-response.dto';
import { OrderSlaSummaryResponseDto } from './dto/order-sla-summary-response.dto';
import { OrderSlaSummaryQueryDto } from './dto/order-sla-summary-query.dto';
import { OrderLifecyclePhaseSummaryResponseDto } from './dto/order-lifecycle-phase-summary-response.dto';
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
    // #2287: the packed writes go through the SERVICE, not the repository port
    // this controller injects for its reads. The two guarded statements plus
    // the re-read that tells "already packed" from "no such order" are one
    // policy, and it belongs in the application layer where the other writers
    // (`markCancelled`, `markSalesDocumentBlock`) already live.
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService,
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
      salesDocumentBlocked,
      cancelled,
      phase,
      taxRateConflict,
      limit = 20,
      offset = 0,
    } = query;

    // #2441 review I-1 — `?cancelled=` (#2306) and `?phase=` (#2309) are two filters over
    // the SAME fact: the lifecycle `CASE`'s top arm is `cancelledAt IS NOT NULL`, so
    // `phase=cancelled` IS `cancelled=true`. ANDed, a contradictory pair is structurally
    // empty for every row in the table — which reads to an operator as "no orders match"
    // rather than "these two filters cannot both hold", and beside a non-zero summary count
    // it is exactly the "the number and the rows disagree" failure the wave's
    // `total = Σ buckets` design exists to prevent. Reject naming the conflict instead.
    if (cancelled !== undefined && phase !== undefined) {
      const phaseIsCancelled = phase === 'cancelled';
      if (phaseIsCancelled !== cancelled) {
        throw new BadRequestException(
          phaseIsCancelled
            ? '?phase=cancelled contradicts ?cancelled=false: the cancelled phase IS the cancelled ' +
              'set, so this pair can never match a row. Omit ?cancelled, or pass ?cancelled=true.'
            : `?phase=${phase} contradicts ?cancelled=true: only ?phase=cancelled can match a ` +
              'cancelled order, so this pair can never match a row. Omit ?cancelled, or pass ' +
              '?cancelled=false.'
        );
      }
    }

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
        salesDocumentBlocked,
        cancelled,
        // #2309 — the query param is `phase`; the repository filter names the
        // full axis, since `OrderRecordFilters` already carries several
        // orthogonal ones.
        lifecyclePhase: phase,
        taxRateConflict,
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
    const summary = await this.orderRecordRepository.countByHealth({
      sourceConnectionId,
      customerId,
      createdFrom: createdFrom ? new Date(createdFrom) : undefined,
      createdTo: createdTo ? new Date(createdTo) : undefined,
    });
    // The wire carries an ISO string; the domain summary carries a Date (#2254).
    return {
      ...summary,
      salesDocumentBlockedOldestAt: summary.salesDocumentBlockedOldestAt?.toISOString() ?? null,
    };
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
    @Query() query: OrderSlaSummaryQueryDto
  ): Promise<OrderSlaSummaryResponseDto> {
    const { sourceConnectionId, customerId, createdFrom, createdTo, cancelled } = query;
    return this.orderRecordRepository.countBySla({
      sourceConnectionId,
      customerId,
      createdFrom: createdFrom ? new Date(createdFrom) : undefined,
      createdTo: createdTo ? new Date(createdTo) : undefined,
      cancelled,
    });
  }

  @Get('lifecycle-summary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Order lifecycle-phase summary counts',
    description:
      'Returns the count of order records per derived lifecycle phase (cancelled | vendor_authoritative | delivered | in_transit | fulfillment_failed | held | amending | blocked | ready) for the given source/customer/date scope (#2309, ADR-059). Every bucket tests the same expression the `?phase=` filter tests, so `total` equals their sum and each count matches the rows that filter returns. A SECOND ORTHOGONAL PARTITION beside GET /orders/status-summary, never a sixth health bucket. Three buckets are structurally 0 until Waves 2 and 4 persist the facts they read.',
  })
  @ApiResponse({
    status: 200,
    description: 'Per-lifecycle-phase counts',
    type: OrderLifecyclePhaseSummaryResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async lifecycleSummary(
    @Query() query: OrderHealthSummaryQueryDto
  ): Promise<OrderLifecyclePhaseSummaryResponseDto> {
    const { sourceConnectionId, customerId, createdFrom, createdTo } = query;
    // Deliberately no `cancelled` scope: cancellation is this partition's TOP
    // arm, so scoping by it would re-scope the axis the partition expresses.
    return this.orderRecordRepository.countByLifecyclePhase({
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

  @Roles('admin', 'operator')
  @Post(':internalOrderId/packed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark an order packed',
    description:
      'Records the plain operator fact that this order is packed, stamping the instant (server-side) and the acting user. ' +
      'It is a fact, not a state: recordStatus, fulfillmentState, slaState and the order-health buckets are untouched, and nothing is gated on it. ' +
      'Idempotent — a repeat call returns the EXISTING stamp and actor rather than re-stamping, which is why it answers 200 and not 201.',
  })
  @ApiResponse({ status: 200, description: 'Order is packed', type: OrderRecordResponseDto })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async markPacked(
    @Param('internalOrderId') internalOrderId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<OrderRecordResponseDto> {
    try {
      return this.toDto(await this.orderRecordService.markPacked(internalOrderId, user.id));
    } catch (error) {
      if (error instanceof OrderRecordNotFoundException) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  @Roles('admin', 'operator')
  @Delete(':internalOrderId/packed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clear an order’s packed mark',
    description:
      'Clears both packed fields together. Clearing an order that is not packed is a no-op that returns the record unchanged.',
  })
  @ApiResponse({ status: 200, description: 'Order is not packed', type: OrderRecordResponseDto })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async clearPacked(
    @Param('internalOrderId') internalOrderId: string
  ): Promise<OrderRecordResponseDto> {
    try {
      return this.toDto(await this.orderRecordService.clearPacked(internalOrderId));
    } catch (error) {
      if (error instanceof OrderRecordNotFoundException) {
        throw new NotFoundException(error.message);
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
      mappingFailureReason: order.mappingFailureReason,
      salesDocumentBlockReason: order.salesDocumentBlockReason,
      salesDocumentUnresolvedReason: order.salesDocumentUnresolvedReason,
      salesDocumentBlockDetail: order.salesDocumentBlockDetail,
      salesDocumentBlockedAt: order.salesDocumentBlockedAt?.toISOString() ?? null,
      salesDocumentBlockReleasedAt: order.salesDocumentBlockReleasedAt?.toISOString() ?? null,
      createdAt: order.createdAt instanceof Date ? order.createdAt.toISOString() : order.createdAt,
      updatedAt: order.updatedAt instanceof Date ? order.updatedAt.toISOString() : order.updatedAt,
      dispatchByAt: order.dispatchByAt ? order.dispatchByAt.toISOString() : null,
      cancelledAt: order.cancelledAt ? order.cancelledAt.toISOString() : null,
      // Operator packed fact (#2287). Projected on the SHARED toDto, so it
      // reaches the list and the detail response from one place.
      packedAt: order.packedAt ? order.packedAt.toISOString() : null,
      packedByUserId: order.packedByUserId,
      // Source-amendment fact (#2283). On the SHARED toDto for the same reason
      // as `packedAt`: one projection reaches both the list and the detail
      // response, so a follow-up list badge needs no second wiring.
      lastAmendedAt: order.lastAmendedAt ? order.lastAmendedAt.toISOString() : null,
      lastAmendmentChanges: order.lastAmendmentChanges,
      // Ship-by estimate flag (#1776): a typed, fail-safe read off the snapshot's
      // dispatch window. Erli marks its derived window `estimated: true`; Allegro
      // leaves it absent (authoritative). Narrowing lives on the entity getter.
      dispatchByEstimated: order.dispatchByEstimated,
      fulfillmentState,
      // BE-owned SLA bucket (#1108): single source of truth so the list filter +
      // badge agree. The FE renders only the live countdown off dispatchByAt.
      slaState: deriveSlaState(order.dispatchByAt, order.fulfillmentState, new Date()),
      // BE-owned derived lifecycle phase (#2309, ADR-059). Produced by the ONE
      // pure derivation, whose SQL twin backs `?phase=` — so the badge and the
      // filter agree. On the SHARED toDto, so list and detail read it from one
      // place. Clock-free, unlike slaState above: no `new Date()` here, and none
      // inside. Each not-yet-persisted input carries the wave that wires it, so
      // the wiring points stay greppable.
      lifecyclePhase: deriveOrderLifecyclePhase({
        cancelledAt: order.cancelledAt ?? null,
        fulfillmentState: order.fulfillmentState,
        // #2340 — the denormalised projection of the open `order_holds` row.
        // Read here rather than through `IOrderHoldService` because `toDto` runs
        // per row on the paged list; the SQL twin's `held` arm reads the same
        // column, which is what keeps this badge and `?phase=held` in agreement.
        activeHoldReason: order.activeHoldReason,
        hasOpenAmendment: false, // Wave 2 — widened `order_changes.kind`
        recordStatus: order.recordStatus,
        authority: DEFAULT_LIFECYCLE_AUTHORITY, // Wave 4 binds this per order at ingestion
        vendorDeclaredPhase: null, // Wave 4 — posture-B columns
      }),
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
      blocksIssuanceElsewhere: record.blocksIssuanceElsewhere,
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
