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
  Body,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
  ORDER_HOLD_SERVICE_TOKEN,
  ORDER_PROVISIONING_RESUME_SERVICE_TOKEN,
  OrderAlreadyOnHoldError,
  OrderHoldContendedError,
  OrderHoldNotFoundError,
  HoldAlreadyReleasedError,
  HoldReleaseNoteRequiredError,
  HoldReleaseNotPermittedError,
  deriveSlaState,

  IOrderHoldService,
  IOrderProvisioningResumeService} from '@openlinker/core/orders';
import type {
  OrderRecord,
  OrderSyncStatus,
  SyncAttempt,
  OrderHold,
  OrderProvisioningResumeResult,
} from '@openlinker/core/orders';
import {
  INVOICE_SERVICE_TOKEN,
  IInvoiceService,
} from '@openlinker/core/invoicing';
import { Logger } from '@openlinker/shared/logging';
import type { InvoiceRecord } from '@openlinker/core/invoicing';
import {
  RESERVATION_SHORTFALL_SERVICE_TOKEN,
  type IReservationShortfallService,
  type ReservationShortfallEpisode,
} from '@openlinker/core/inventory';
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
import { PlaceOrderHoldRequestDto } from './dto/place-order-hold-request.dto';
import { ReleaseOrderHoldRequestDto } from './dto/release-order-hold-request.dto';
import type {
  OrderHoldDto,
  ProvisioningResumeDto} from './dto/order-hold-response.dto';
import {
  PlaceOrderHoldResponseDto,
  ReleaseOrderHoldResponseDto,
} from './dto/order-hold-response.dto';
import type { OrderInvoiceProjectionDto } from './dto/order-invoice-projection.dto';
import type { OrderReservationShortfallDto } from './dto/order-reservation-shortfall.dto';
import type { OrderDeliveryResolutionDto } from './dto/order-delivery-resolution.dto';
import type { OrderDeliveryRiderDto } from './dto/order-delivery-rider.dto';

@ApiBearerAuth()
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name);

  constructor(
    @Inject(RESERVATION_SHORTFALL_SERVICE_TOKEN)
    private readonly reservationShortfalls: IReservationShortfallService,
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
    private readonly deliveryRider: IDeliveryRiderService,
    // #2341 — holds are reached ONLY through the service seam. The intra-context
    // `OrderHoldRepositoryPort` is deliberately absent from the barrel (#2338).
    @Inject(ORDER_HOLD_SERVICE_TOKEN)
    private readonly holdService: IOrderHoldService,
    @Inject(ORDER_PROVISIONING_RESUME_SERVICE_TOKEN)
    private readonly provisioningResume: IOrderProvisioningResumeService
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
      attention,
      hold,
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
        // #2353 - the query param is `attention` (the operator-facing word the
        // FE chip uses); the repository filter names the full axis, the same
        // `phase` -> `lifecyclePhase` split, which exists precisely because
        // `OrderRecordFilters` already carries several orthogonal ones.
        omsAttention: attention,
        // #2342 — the query param is the short `hold`; the repository filter
        // names the column it reads, matching the `phase` -> `lifecyclePhase`
        // precedent two lines up.
        activeHoldReason: hold,
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

    // Batch the shortfall projection for the whole page (#2350), the same shape
    // and for the same reason as the invoice batch above: one read across the
    // page's order ids, never a per-row `listOpenForOrder`. #2349 put the field
    // on the DETAIL read only precisely to avoid an N+1 here — this adds the
    // batched list read beside that decision rather than moving the field.
    //
    // Best-effort, matching the detail read: a failed projection must not take
    // the whole order list down. An order absent from the map carries no
    // `reservationShortfalls`, which the FE reads as "nothing reported" and
    // never as a positive "this order is fine".
    const shortfallByOrderId = await this.loadReservationShortfallsForPage(
      items.map((order) => order.internalOrderId)
    );

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
        const shortfalls = shortfallByOrderId.get(order.internalOrderId);
        if (shortfalls && shortfalls.length > 0) {
          dto.reservationShortfalls = shortfalls;
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
    // Still-open reservation shortfalls (#2349). DETAIL read only — putting it
    // on the shared `toDto` would cost one lookup per row on every page of
    // `/orders`. Best-effort: a shortfall projection failing must not take the
    // whole order detail down with it, and the episodes are re-readable.
    dto.reservationShortfalls = await this.loadReservationShortfalls(order.internalOrderId);
    // Hold projection (#2341). DETAIL ONLY — one query per order, which on the
    // paged list would be N. `activeHold` is derived from the same read rather
    // than a second `getOpenHold` call, so the two answers cannot disagree.
    //
    // Consequence worth knowing: this widens the blast radius of
    // `OrderHoldVocabularyError`. One `order_holds` row carrying a reason
    // outside the closed union now fails the WHOLE order-detail read, not just a
    // hold surface. Reaching that needs direct SQL — both the request DTO and
    // the service validate against the union — so failing loudly is the right
    // trade, but it is a new consequence rather than a pre-existing one.
    const holds = await this.holdService.listHolds(order.internalOrderId);
    dto.holdHistory = holds.map((hold) => this.toHoldDto(hold));
    dto.activeHold = dto.holdHistory.find((hold) => hold.releasedAt === null) ?? null;
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

  /**
   * The list page's batched shortfall projection.
   *
   * Returns an EMPTY map on failure, never throws: one supplementary panel must
   * not take a page of orders down with it. That is why the FE must never
   * render an absent entry as "no shortfalls" — absence and failure look the
   * same here by design, so only the presence of an episode is a claim.
   */
  private async loadReservationShortfallsForPage(
    internalOrderIds: string[]
  ): Promise<Map<string, OrderReservationShortfallDto[]>> {
    if (internalOrderIds.length === 0) {
      return new Map();
    }
    try {
      const grouped = await this.reservationShortfalls.listOpenForOrders(internalOrderIds);
      return new Map(
        [...grouped.entries()].map(([orderId, episodes]) => [
          orderId,
          episodes.map((episode) => this.toReservationShortfallDto(episode)),
        ])
      );
    } catch (error) {
      this.logger.error(
        `Failed to project reservation shortfalls for a page of ${String(
          internalOrderIds.length
        )} order(s)`,
        (error as Error).stack
      );
      return new Map();
    }
  }

  private async loadReservationShortfalls(
    internalOrderId: string
  ): Promise<OrderReservationShortfallDto[]> {
    try {
      const episodes = await this.reservationShortfalls.listOpenForOrder(internalOrderId);
      return episodes.map((episode) => this.toReservationShortfallDto(episode));
    } catch (error) {
      this.logger.error(
        `Failed to project reservation shortfalls for order ${internalOrderId}`,
        (error as Error).stack
      );
      return [];
    }
  }

  private toReservationShortfallDto(
    episode: ReservationShortfallEpisode
  ): OrderReservationShortfallDto {
    return {
      episodeId: episode.id,
      inventoryItemId: episode.inventoryItemId,
      productVariantId: episode.productVariantId,
      sku: episode.sku,
      shortQuantity: episode.shortQuantity,
      positionShortfall: episode.positionShortfall,
      openedAt: episode.openedAt.toISOString(),
    };
  }

  @Roles('admin')
  @Post(':internalOrderId/holds')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Place a hold on an order',
    description:
      'Stops OpenLinker provisioning this order to its destination and dispatching it, until the ' +
      'hold is released. The reason is a closed vocabulary; the acting user is taken from the ' +
      'session, never the body. At most one hold is open per order — a second attempt answers 409.',
  })
  @ApiResponse({ status: 201, description: 'Hold placed', type: PlaceOrderHoldResponseDto })
  @ApiResponse({ status: 400, description: 'Unknown hold reason' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({
    status: 409,
    description:
      'ORDER_ALREADY_ON_HOLD — the order already has an open hold; or ' +
      'ORDER_HOLD_CONTENDED — a concurrent placement took and released the slot, so retry',
  })
  async placeHold(
    @Param('internalOrderId') internalOrderId: string,
    @Body() dto: PlaceOrderHoldRequestDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<PlaceOrderHoldResponseDto> {
    // Read-then-act against a concurrently-deleted order. `order_holds` carries
    // no FK by design (#2338), so a hold could in principle outlive its order.
    // NOT worth a lock: the window is tiny and the row is inert audit data.
    const order = await this.orderRecordRepository.findById(internalOrderId);
    if (!order) {
      throw new NotFoundException(`Order not found: ${internalOrderId}`);
    }

    try {
      const { hold, dispatchInFlight } = await this.holdService.place({
        internalOrderId,
        reason: dto.reason,
        note: dto.note ?? null,
        placedBy: { kind: 'user', userId: user.id },
      });
      return { hold: this.toHoldDto(hold), dispatchInFlight };
    } catch (error) {
      if (error instanceof OrderHoldContendedError) {
        // A DIFFERENT 409 from the one below, and the distinction is the point:
        // the order is NOT held (a peer took and released the slot), so the
        // remedy is to try again rather than to look at an open hold. Before
        // this the repository re-threw the driver error and the operator got a
        // 500 carrying a duplicate-key message.
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          error: 'ORDER_HOLD_CONTENDED',
          message: error.message,
        });
      }
      if (error instanceof OrderAlreadyOnHoldError) {
        // A machine-readable code, because "already on hold" and "already
        // released" are both 409 and their remedies differ.
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          error: 'ORDER_ALREADY_ON_HOLD',
          message: error.message,
        });
      }
      throw error;
    }
  }

  @Roles('admin')
  @Post(':internalOrderId/holds/:holdId/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Release a hold on an order',
    description:
      'Ends the hold and re-enqueues the provisioning run it was suppressing. A note is required ' +
      'when releasing a hold that a service placed. The response reports what happened to that ' +
      're-enqueue rather than assuming it: marketplace.order.sync has no cron backstop for one ' +
      'order. On a failed enqueue every destination the hold was withholding is marked failed, so ' +
      'the order is visibly stranded and the existing per-destination retry recovers it.',
  })
  @ApiResponse({ status: 200, description: 'Hold released', type: ReleaseOrderHoldResponseDto })
  @ApiResponse({ status: 400, description: 'A note is required to release a service-placed hold' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Order not found, or no such hold on this order' })
  @ApiResponse({ status: 409, description: 'HOLD_ALREADY_RELEASED — the hold is already released' })
  async releaseHold(
    @Param('internalOrderId') internalOrderId: string,
    @Param('holdId') holdId: string,
    @Body() dto: ReleaseOrderHoldRequestDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<ReleaseOrderHoldResponseDto> {
    // The ownership check PRECEDES the write. Releasing first and 404-ing after
    // would perform a side effect on the refusal path — the hold released while
    // the caller is told nothing happened. This pre-read only decides WHICH
    // refusal: a concurrent release in the window is caught below as 409.
    const holds = await this.holdService.listHolds(internalOrderId);
    if (!holds.some((hold) => hold.id === holdId)) {
      throw new NotFoundException(
        `Hold not found on order ${internalOrderId}: ${holdId}`
      );
    }

    let released: OrderHold;
    try {
      const transition = await this.holdService.release({
        holdId,
        note: dto.note ?? null,
        releasedBy: { kind: 'user', userId: user.id },
      });
      released = transition.hold;
    } catch (error) {
      if (error instanceof OrderHoldNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof HoldAlreadyReleasedError) {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          error: 'HOLD_ALREADY_RELEASED',
          message: error.message,
        });
      }
      if (error instanceof HoldReleaseNoteRequiredError) {
        // Fixable by resubmitting with a note — a request problem, not a
        // permission one.
        throw new BadRequestException(error.message);
      }
      if (error instanceof HoldReleaseNotPermittedError) {
        // Unreachable from this route (the actor is always a user), but mapped
        // so a future service-actor route cannot fall through to a 500.
        throw new ForbiddenException(error.message);
      }
      throw error;
    }

    // The release is the fact; the enqueue is a consequence (#2341). The service
    // never throws for a modelled condition — this catch is a last-resort guard
    // for an UNMODELLED throw only, so a release that DID happen can never
    // answer 5xx and send the operator into a HoldAlreadyReleasedError retry.
    let resume: OrderProvisioningResumeResult;
    try {
      resume = await this.provisioningResume.resume(released.internalOrderId);
    } catch {
      resume = { status: 'failed', reason: 'enqueue-failed' };
    }

    return {
      hold: this.toHoldDto(released),
      provisioningResume: this.toProvisioningResumeDto(resume),
    };
  }

  /** TypeORM may hand back a string for a timestamptz; `toDto` guards the same way. */
  private toIsoOrPassThrough(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
  }

  private toHoldDto(hold: OrderHold): OrderHoldDto {
    return {
      id: hold.id,
      internalOrderId: hold.internalOrderId,
      reason: hold.reason,
      note: hold.note,
      placedByUserId: hold.placedByUserId,
      placedByService: hold.placedByService,
      // `toDto` below guards its own dates the same way: TypeORM has handed this
      // codebase a string before, and `OrderHoldRepository.toDomain` passes the
      // entity's dates through with no coercion.
      placedAt: this.toIsoOrPassThrough(hold.placedAt),
      releasedAt: hold.releasedAt ? this.toIsoOrPassThrough(hold.releasedAt) : null,
      releasedByUserId: hold.releasedByUserId,
      releaseNote: hold.releaseNote,
      createdAt: this.toIsoOrPassThrough(hold.createdAt),
      updatedAt: this.toIsoOrPassThrough(hold.updatedAt),
    };
  }

  private toProvisioningResumeDto(
    result: OrderProvisioningResumeResult
  ): ProvisioningResumeDto {
    return {
      status: result.status,
      jobId: result.status === 'enqueued' ? result.jobId : null,
      // `enqueued` carries no reason; both other arms name theirs. The code is
      // never the caught provider message — see the resume service's docblock.
      reason: result.status === 'enqueued' ? null : result.reason,
    };
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
      // #2356 - on the SHARED toDto, like `packedAt` above: the badge renders on
      // the list AND the detail page, and the entity's own getter has already
      // coerced the jsonb through core's guard, so an unrecognised value is
      // absent here rather than unrenderable downstream.
      omsAttention: order.omsAttention.map((entry) => ({
        producer: entry.producer,
        reason: entry.reason,
        detail: entry.detail ?? null,
        subjectRef: entry.subjectRef ?? null,
        since: entry.since,
      })),
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
      // #2341 — the ONE hold fact the list gets, and it is free: the column is
      // already loaded, so no query is added per row. `activeHold` /
      // `holdHistory` stay detail-only because those ARE a query per row.
      // #2340's display cache: a badge may render it, no gate may read it.
      activeHoldReason: order.activeHoldReason,
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
