/**
 * Shipment Controller
 *
 * HTTP REST endpoints for shipments (#846): a filtered/paginated list, single
 * + active-by-order reads, and the two commands — generate-label (delegates to
 * the #835 dispatch seam) and cancel. Reads/commands go through `I*Service`
 * seams (never `ShipmentRepositoryPort` — banned cross-context in apps/**).
 * The read paths enrich each row's `customerId` by resolving its order via
 * `IOrderRecordService` (#770; degrades to null on lookup failure).
 * Domain exceptions are mapped to HTTP at this boundary. Admin + JWT.
 *
 * @module apps/api/src/shipping/http
 */

import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  type IShipmentCancellationService,
  type IShipmentDispatchNotificationService,
  type IShipmentDispatchService,
  type IShipmentQueryService,
  type ShipmentDispatchInput,
  type ShipmentFilters,
  SHIPMENT_CANCELLATION_SERVICE_TOKEN,
  SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN,
  SHIPMENT_DISPATCH_SERVICE_TOKEN,
  SHIPMENT_QUERY_SERVICE_TOKEN,
  ShipmentCancellationNotSupportedException,
  ShipmentNotCancellableException,
  ShipmentNotFoundException,
  ShippingProviderRejectionException,
  UndispatchableResolutionException,
} from '@openlinker/core/shipping';
import { type IOrderRecordService, ORDER_RECORD_SERVICE_TOKEN } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';
import { Roles } from '../../auth/decorators/roles.decorator';
import { DispatchResultResponseDto } from './dto/dispatch-result-response.dto';
import { GenerateLabelDto } from './dto/generate-label.dto';
import { ListShipmentsQueryDto } from './dto/list-shipments-query.dto';
import { NotifyDispatchedResponseDto } from './dto/notify-dispatched-response.dto';
import { PaginatedShipmentsResponseDto } from './dto/paginated-shipments-response.dto';
import { ShipmentResponseDto } from './dto/shipment-response.dto';

@Roles('admin')
@ApiBearerAuth()
@ApiTags('shipments')
@Controller('shipments')
export class ShipmentController {
  private readonly logger = new Logger(ShipmentController.name);

  constructor(
    @Inject(SHIPMENT_QUERY_SERVICE_TOKEN)
    private readonly query: IShipmentQueryService,
    @Inject(SHIPMENT_DISPATCH_SERVICE_TOKEN)
    private readonly dispatch: IShipmentDispatchService,
    @Inject(SHIPMENT_CANCELLATION_SERVICE_TOKEN)
    private readonly cancellation: IShipmentCancellationService,
    @Inject(SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN)
    private readonly notification: IShipmentDispatchNotificationService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orders: IOrderRecordService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List shipments across orders and connections' })
  @ApiResponse({ status: 200, type: PaginatedShipmentsResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async list(@Query() query: ListShipmentsQueryDto): Promise<PaginatedShipmentsResponseDto> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const filters: ShipmentFilters = {
      orderId: query.orderId,
      status: query.status,
      connectionId: query.connectionId,
      shippingMethod: query.shippingMethod,
      hasTracking: query.hasTracking,
      createdFrom: query.createdFrom ? new Date(query.createdFrom) : undefined,
      createdTo: query.createdTo ? new Date(query.createdTo) : undefined,
    };

    const page = await this.query.list(filters, { limit, offset });
    const customerByOrder = await this.resolveCustomerIds(page.items.map((s) => s.orderId));
    return {
      items: page.items.map((shipment) =>
        ShipmentResponseDto.fromDomain(shipment, customerByOrder.get(shipment.orderId) ?? null),
      ),
      total: page.total,
      limit,
      offset,
    };
  }

  // Declared BEFORE `:id` — Express matches in order, so `:id` would otherwise
  // capture the literal segment `active`.
  @Get('active')
  @ApiOperation({ summary: "Get an order's current active (non-terminal) shipment" })
  @ApiQuery({ name: 'orderId', type: String, required: true })
  @ApiResponse({ status: 200, type: ShipmentResponseDto })
  @ApiResponse({ status: 404, description: 'No active shipment for the order' })
  async getActive(@Query('orderId') orderId?: string): Promise<ShipmentResponseDto> {
    if (!orderId) {
      throw new BadRequestException('orderId query parameter is required');
    }
    const shipment = await this.query.getActiveByOrderId(orderId);
    if (!shipment) {
      throw new NotFoundException(`No active shipment for order: ${orderId}`);
    }
    return ShipmentResponseDto.fromDomain(shipment, await this.resolveCustomerId(shipment.orderId));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a shipment by id' })
  @ApiResponse({ status: 200, type: ShipmentResponseDto })
  @ApiResponse({ status: 404, description: 'Shipment not found' })
  async getById(@Param('id') id: string): Promise<ShipmentResponseDto> {
    const shipment = await this.query.getById(id);
    if (!shipment) {
      throw new NotFoundException(`Shipment not found: ${id}`);
    }
    return ShipmentResponseDto.fromDomain(shipment, await this.resolveCustomerId(shipment.orderId));
  }

  @Post('generate-label')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate a shipping label for an order via the resolved fulfillment processor',
  })
  @ApiResponse({ status: 200, type: DispatchResultResponseDto })
  @ApiResponse({ status: 422, description: 'Routing resolution cannot be dispatched' })
  @ApiResponse({ status: 502, description: 'Shipping provider rejected label generation' })
  async generateLabel(@Body() dto: GenerateLabelDto): Promise<DispatchResultResponseDto> {
    const input: ShipmentDispatchInput = {
      sourceConnectionId: dto.sourceConnectionId,
      sourceDeliveryMethodId: dto.sourceDeliveryMethodId ?? null,
      orderId: dto.orderId,
      shippingMethod: dto.shippingMethod,
      paczkomatId: dto.paczkomatId,
      recipient: dto.recipient,
      parcel: dto.parcel,
    };
    try {
      const result = await this.dispatch.dispatch(input);
      return DispatchResultResponseDto.fromResult(result);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a not-yet-dispatched shipment' })
  @ApiResponse({ status: 200, type: ShipmentResponseDto })
  @ApiResponse({ status: 404, description: 'Shipment not found' })
  @ApiResponse({ status: 409, description: 'Shipment is past the cancellable window' })
  @ApiResponse({ status: 422, description: 'Provider does not support cancellation' })
  async cancel(@Param('id') id: string): Promise<ShipmentResponseDto> {
    try {
      const shipment = await this.cancellation.cancel(id);
      return ShipmentResponseDto.fromDomain(shipment);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Post(':id/notify-dispatched')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Operator-fired #837 dispatch-notify orchestration: source mark-shipped + ' +
      'destination OMP fulfillment-update + advance Shipment.status to dispatched.',
    description:
      'Manual override path for the dispatch-notify projection (#769). Normal flow ' +
      'is automatic — InPost webhooks (deferred to #768) and Allegro Delivery status-' +
      'sync (#838) fire this same service. The endpoint exists so operators can ' +
      'unstick a `generated` shipment when the automatic path has stalled or the ' +
      'projection needs to be replayed. Idempotent: re-firing on an already-dispatched ' +
      'shipment returns 200 with `outcome=skipped-not-generated`, not 409.',
  })
  @ApiResponse({ status: 200, type: NotifyDispatchedResponseDto })
  @ApiResponse({ status: 404, description: 'Shipment not found' })
  async notifyDispatched(@Param('id') id: string): Promise<NotifyDispatchedResponseDto> {
    const result = await this.notification.notifyDispatched({ shipmentId: id });
    if (result.outcome === 'shipment-not-found') {
      throw new NotFoundException(`Shipment not found: ${id}`);
    }
    return NotifyDispatchedResponseDto.fromResult(result);
  }

  /**
   * Resolve an order's customer id (`Order.customerId`) for the customer column.
   * Returns null when the order is unknown or has no customer. Cross-context
   * read via `IOrderRecordService` (host-layer composition — orders is reached
   * through its `I*Service`, not its repository).
   */
  private async resolveCustomerId(orderId: string): Promise<string | null> {
    // The customer column is a secondary enrichment — a failed order lookup must
    // NOT take down the primary shipments read. Degrade to null on error
    // (mirrors how the FE entity-labels degrade to the bare id).
    try {
      const order = await this.orders.getOrderRecord(orderId);
      return order?.customerId ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to resolve customer for order ${orderId}: ${message}`);
      return null;
    }
  }

  /**
   * Batch-resolve customer ids for a page of shipments. Dedupes order ids so a
   * page with N shipments across M distinct orders costs M lookups, not N.
   * NOTE: no batch read exists on `IOrderRecordService` yet — this is M single
   * `getOrderRecord` calls; a `findByIds` batch is a tracked follow-up.
   */
  private async resolveCustomerIds(orderIds: string[]): Promise<Map<string, string | null>> {
    const distinct = [...new Set(orderIds)];
    const entries = await Promise.all(
      distinct.map(async (orderId): Promise<[string, string | null]> => [
        orderId,
        await this.resolveCustomerId(orderId),
      ]),
    );
    return new Map(entries);
  }

  /**
   * Map shipment domain exceptions to HTTP. Typed `ShippingProviderRejectionException`
   * (an upstream-carrier rejection) maps to 502; non-typed errors fall through
   * to 500 (Nest's default) so an internal failure (DB drop, missing config,
   * programming bug) doesn't get mis-attributed to "carrier API is down".
   *
   * Note (tech-review SUGGESTION partial fix): adapters today still throw bare
   * `Error` for provider rejections rather than the typed exception. Until the
   * adapter migration completes, the fallback below logs the unknown error and
   * 500s — operators monitoring 502 cardinality will see the carrier-rejection
   * count drop to ~0 until the adapters catch up. The trade-off is honest:
   * 500 is correct for "we don't know what this is", and the structured log
   * carries the message + stack so triage is unaffected.
   */
  private toHttpException(error: unknown): Error {
    if (error instanceof ShipmentNotFoundException) {
      return new NotFoundException(error.message);
    }
    if (error instanceof ShipmentNotCancellableException) {
      return new ConflictException(error.message);
    }
    if (
      error instanceof ShipmentCancellationNotSupportedException ||
      error instanceof UndispatchableResolutionException
    ) {
      return new UnprocessableEntityException(error.message);
    }
    if (error instanceof ShippingProviderRejectionException) {
      return new BadGatewayException(error.message);
    }
    if (error instanceof Error) {
      this.logger.error(
        `Unclassified shipping-command error: ${error.message}`,
        error.stack,
      );
      return new InternalServerErrorException(error.message);
    }
    return new InternalServerErrorException(String(error));
  }
}
