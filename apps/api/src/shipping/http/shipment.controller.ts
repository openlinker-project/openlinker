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
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  type IBulkShipmentDispatchService,
  type IShipmentCancellationService,
  type IShipmentDispatchNotificationService,
  type IShipmentDispatchService,
  type IShipmentLabelService,
  type IShipmentQueryService,
  type BulkShipmentDispatchItem,
  type ShipmentDispatchInput,
  type ShipmentFilters,
  BULK_SHIPMENT_DISPATCH_SERVICE_TOKEN,
  SHIPMENT_CANCELLATION_SERVICE_TOKEN,
  SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN,
  SHIPMENT_DISPATCH_SERVICE_TOKEN,
  SHIPMENT_LABEL_SERVICE_TOKEN,
  SHIPMENT_QUERY_SERVICE_TOKEN,
  DispatchProtocolNotSupportedException,
  InvalidProtocolBatchException,
  LabelDocumentNotSupportedException,
  LabelNotAvailableException,
  ShipmentCancellationNotSupportedException,
  ShipmentNotCancellableException,
  ShipmentNotFoundException,
  ShippingProviderAuthException,
  ShippingProviderRejectionException,
  UndispatchableResolutionException,
  OrderNotDispatchablePaymentStatusException,
  OrderNotDispatchableHeldException,
  ShipmentDispatchContendedException,
} from '@openlinker/core/shipping';
import {
  type IOrderRecordService,
  ORDER_RECORD_SERVICE_TOKEN,
  buildOrderSummary,
  type OrderSummary,
} from '@openlinker/core/orders';
import { ROLE_PERMISSIONS } from '@openlinker/core/users';
import { Logger } from '@openlinker/shared/logging';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import { BulkDispatchResultResponseDto } from './dto/bulk-dispatch-result-response.dto';
import { BulkGenerateLabelsDto } from './dto/bulk-generate-labels.dto';
import { DispatchResultResponseDto } from './dto/dispatch-result-response.dto';
import { GenerateLabelDto } from './dto/generate-label.dto';
import { GenerateProtocolDto } from './dto/generate-protocol.dto';
import { ListShipmentsQueryDto } from './dto/list-shipments-query.dto';
import { NotifyDispatchedResponseDto } from './dto/notify-dispatched-response.dto';
import { PaginatedShipmentsResponseDto } from './dto/paginated-shipments-response.dto';
import { REDACTED_ERROR_MESSAGE, ShipmentResponseDto } from './dto/shipment-response.dto';

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
    @Inject(BULK_SHIPMENT_DISPATCH_SERVICE_TOKEN)
    private readonly bulkDispatch: IBulkShipmentDispatchService,
    @Inject(SHIPMENT_CANCELLATION_SERVICE_TOKEN)
    private readonly cancellation: IShipmentCancellationService,
    @Inject(SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN)
    private readonly notification: IShipmentDispatchNotificationService,
    @Inject(SHIPMENT_LABEL_SERVICE_TOKEN)
    private readonly label: IShipmentLabelService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orders: IOrderRecordService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List shipments across orders and connections' })
  @ApiResponse({ status: 200, type: PaginatedShipmentsResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async list(
    @Query() query: ListShipmentsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaginatedShipmentsResponseDto> {
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

    const canWrite = this.hasShipmentsWrite(user);
    const page = await this.query.list(filters, { limit, offset });
    const orderContext = await this.resolveOrderContext(page.items.map((s) => s.orderId));
    return {
      items: page.items.map((shipment) => {
        const context = orderContext.get(shipment.orderId);
        return ShipmentResponseDto.fromDomain(
          shipment,
          context?.customerId ?? null,
          canWrite,
          context?.orderSummary ?? null,
        );
      }),
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
  async getActive(
    @Query('orderId') orderId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ShipmentResponseDto> {
    if (!orderId) {
      throw new BadRequestException('orderId query parameter is required');
    }
    const shipment = await this.query.getActiveByOrderId(orderId);
    if (!shipment) {
      throw new NotFoundException(`No active shipment for order: ${orderId}`);
    }
    return ShipmentResponseDto.fromDomain(
      shipment,
      await this.resolveCustomerId(shipment.orderId),
      this.hasShipmentsWrite(user),
      null,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a shipment by id' })
  @ApiResponse({ status: 200, type: ShipmentResponseDto })
  @ApiResponse({ status: 404, description: 'Shipment not found' })
  async getById(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ShipmentResponseDto> {
    const shipment = await this.query.getById(id);
    if (!shipment) {
      throw new NotFoundException(`Shipment not found: ${id}`);
    }
    return ShipmentResponseDto.fromDomain(
      shipment,
      await this.resolveCustomerId(shipment.orderId),
      this.hasShipmentsWrite(user),
      null,
    );
  }

  @Get(':id/label')
  @ApiOperation({
    summary: "Download a shipment's label document (PDF/ZPL/PNG, provider-dependent)",
  })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'Label document bytes (Content-Type per provider)' })
  @ApiResponse({ status: 404, description: 'Shipment not found' })
  @ApiResponse({
    status: 422,
    description: 'No label generated yet, or provider cannot return label documents',
  })
  @ApiResponse({ status: 502, description: 'Shipping provider rejected the label fetch' })
  async downloadLabel(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    // `@Res()` disables Nest's global serializer for this handler — intended,
    // since the response is binary, not JSON. The service call runs FIRST so a
    // thrown domain exception still routes through Nest's exception layer
    // before any header/byte is written; `res.*` only ever runs on success.
    try {
      const { contentType, body } = await this.label.fetchLabel(id);
      const ext = extensionForContentType(contentType);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="ol-shipment-${id}.${ext}"`);
      res.send(Buffer.from(body));
    } catch (error) {
      // This route carries no `@Roles` (a viewer may download a label), so the
      // failure body is the one command-style error surface a viewer reaches —
      // gate its carrier text on the same predicate as the persisted field.
      throw this.toHttpException(error, this.hasShipmentsWrite(user));
    }
  }

  @Post('generate-label')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate a shipping label for an order via the resolved fulfillment processor',
  })
  @ApiResponse({ status: 200, type: DispatchResultResponseDto })
  @ApiResponse({
    status: 422,
    description: 'Order not dispatchable (routing unresolvable, or payment status blocks dispatch)',
  })
  @ApiResponse({ status: 502, description: 'Shipping provider rejected label generation' })
  @ApiResponse({
    status: 409,
    description:
      'A concurrent dispatch for this order is in progress; no label was created by this attempt',
  })
  async generateLabel(@Body() dto: GenerateLabelDto): Promise<DispatchResultResponseDto> {
    const input: ShipmentDispatchInput = {
      sourceConnectionId: dto.sourceConnectionId,
      sourceDeliveryMethodId: dto.sourceDeliveryMethodId ?? null,
      orderId: dto.orderId,
      // Carrier-neutral intent (#979); `shippingMethod` is the deprecated
      // one-release fallback. The seam resolves the carrier method + raises
      // 422 (UndispatchableResolutionException) if neither is usable.
      deliveryIntent: dto.deliveryIntent,
      shippingMethod: dto.shippingMethod,
      paczkomatId: dto.paczkomatId,
      recipient: dto.recipient,
      parcel: dto.parcel,
      // COD pass-through (#966) — caller-supplied; COD-incapable adapters ignore it.
      cod: dto.cod,
      // Insurance pass-through (#1542) — caller-supplied; insurance-incapable
      // adapters ignore it, insurance-capable ones (InPost ShipX) translate it.
      insuredValue: dto.insuredValue,
    };
    try {
      const result = await this.dispatch.dispatch(input);
      return DispatchResultResponseDto.fromResult(result);
    } catch (error) {
      // Route is `@Roles('admin', 'operator')`-gated, so the caller holds
      // `shipments:write` — nothing to redact.
      throw this.toHttpException(error, true);
    }
  }

  @Post('bulk/generate-labels')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dispatch labels for up to 25 orders in one action (#964)',
    description:
      'Synchronous bulk dispatch: loops the per-order dispatch seam, isolating ' +
      'each order so a partial failure keeps the successful labels. Returns a ' +
      'per-order outcome list (200 even on partial failure). Fetch the handover ' +
      'protocol over the dispatched shipments via POST /shipments/bulk/protocol.',
  })
  @ApiResponse({ status: 200, type: BulkDispatchResultResponseDto })
  async bulkGenerateLabels(
    @Body() dto: BulkGenerateLabelsDto,
  ): Promise<BulkDispatchResultResponseDto> {
    const items: BulkShipmentDispatchItem[] = dto.items.map((item) => ({
      sourceDeliveryMethodId: item.sourceDeliveryMethodId ?? null,
      orderId: item.orderId,
      deliveryIntent: item.deliveryIntent,
      shippingMethod: item.shippingMethod,
      paczkomatId: item.paczkomatId,
      recipient: item.recipient,
      parcel: item.parcel,
    }));
    // No try/catch around the whole batch: per-order failures are isolated INSIDE
    // the service (caught into `failed` results), so this resolves 200 with the
    // outcome list. An exception here would be a true infrastructure failure.
    const result = await this.bulkDispatch.dispatchBulk({
      sourceConnectionId: dto.sourceConnectionId,
      items,
    });
    return BulkDispatchResultResponseDto.fromResult(result);
  }

  @Post('bulk/protocol')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Download the carrier handover protocol over a set of dispatched shipments (#964)',
  })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'Handover protocol bytes (Content-Type per provider)' })
  @ApiResponse({
    status: 400,
    description: 'No generated labels in the set, or shipments span multiple carrier connections',
  })
  @ApiResponse({ status: 422, description: 'Carrier does not support handover protocols' })
  @ApiResponse({ status: 502, description: 'Shipping provider rejected protocol generation' })
  async downloadProtocol(@Body() dto: GenerateProtocolDto, @Res() res: Response): Promise<void> {
    // `@Res()` disables Nest's serializer (binary, not JSON). The service runs
    // FIRST so a thrown domain exception still routes through Nest's exception
    // layer before any byte is written; `res.*` only runs on success.
    try {
      const { contentType, body } = await this.bulkDispatch.generateProtocol({
        shipmentIds: dto.shipmentIds,
      });
      const ext = extensionForContentType(contentType);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="ol-handover-protocol.${ext}"`);
      res.send(Buffer.from(body));
    } catch (error) {
      // `@Roles('admin', 'operator')`-gated — the caller holds `shipments:write`.
      throw this.toHttpException(error, true);
    }
  }

  @Post(':id/cancel')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a not-yet-dispatched shipment' })
  @ApiResponse({ status: 200, type: ShipmentResponseDto })
  @ApiResponse({ status: 404, description: 'Shipment not found' })
  @ApiResponse({ status: 409, description: 'Shipment is past the cancellable window' })
  @ApiResponse({ status: 422, description: 'Provider does not support cancellation' })
  async cancel(@Param('id') id: string): Promise<ShipmentResponseDto> {
    try {
      const shipment = await this.cancellation.cancel(id);
      // `@Roles('admin', 'operator')`-gated — the caller holds `shipments:write`.
      return ShipmentResponseDto.fromDomain(shipment, null, true, null);
    } catch (error) {
      throw this.toHttpException(error, true);
    }
  }

  @Post(':id/notify-dispatched')
  @Roles('admin', 'operator')
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
   * Server-side redaction gate (#1826) — mirrors the FE's `usePermission
   * ('shipments:write')` check so a `viewer` session can't bypass the raw
   * carrier-message redaction by reading this endpoint's JSON directly. The
   * FE gate stays too (it also drives write-affordance visibility, not just
   * this one field), but this is the actual enforcement boundary.
   *
   * SCOPE: `shipments:write` is today a DISPLAY predicate only — it gates
   * carrier-text disclosure on the read paths and the FE's write affordances.
   * It authorizes no mutation: every shipping mutation is gated by
   * `@Roles('admin', 'operator')` and there is no permission-based guard in the
   * codebase. The two therefore MUST stay in lockstep — granting
   * `shipments:write` to a third role in `ROLE_PERMISSIONS` would show that
   * role the Regenerate/Cancel buttons and then 403 the click. A spec in
   * `shipment.controller.spec.ts` asserts the role sets are identical so the
   * drift fails a test rather than shipping.
   */
  private hasShipmentsWrite(user: AuthenticatedUser | undefined): boolean {
    // `user.role` is only *declared* `UserRole` — at runtime it arrives verbatim
    // off the JWT (`JwtStrategy.validate`) with no `UserRoleValues` membership
    // check, so an unrecognised role would index to `undefined` and throw.
    // Fail closed (redact), mirroring `UserResponseDto.fromDomain`'s `?? []`.
    const permissions = user ? ROLE_PERMISSIONS[user.role] : undefined;
    return permissions?.includes('shipments:write') ?? false;
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
   * Batch-resolve per-order context (customerId + #1995 orderSummary) for a
   * page of shipments. A SINGLE `IOrderRecordService.findByIds` call scoped to
   * the page's deduplicated order ids — deliberately NOT a `Promise.all` fan-out
   * of single reads (that shape used to live here; see the #1995 issue body's
   * "anti-pattern" callout). Degrades to an empty map (every row's context
   * `undefined`) on a batch-read failure — a broken enrichment must never take
   * down the primary shipments read, mirroring `resolveCustomerId`'s per-row
   * degrade-to-null.
   */
  private async resolveOrderContext(
    orderIds: string[],
  ): Promise<Map<string, { customerId: string | null; orderSummary: OrderSummary | null }>> {
    const distinct = [...new Set(orderIds)];
    if (distinct.length === 0) {
      return new Map();
    }
    let records: Awaited<ReturnType<IOrderRecordService['findByIds']>> = [];
    try {
      records = await this.orders.findByIds(distinct);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to batch-resolve orders for shipments list: ${message}`);
    }
    const recordByOrderId = new Map(records.map((record) => [record.internalOrderId, record]));
    return new Map(
      distinct.map((orderId) => {
        const record = recordByOrderId.get(orderId);
        return [
          orderId,
          {
            customerId: record?.customerId ?? null,
            orderSummary: buildOrderSummary(record),
          },
        ];
      }),
    );
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
   *
   * @param canWrite Whether the requester holds `shipments:write`. Required (no
   *   default) for the same reason as on `ShipmentResponseDto.fromDomain`: the
   *   carrier-rejection 502 body carries the same address-bearing provider text
   *   the persisted `errorMessage` redacts, so a fail-open default would leak it
   *   through the only command-style error surface a viewer can reach.
   */
  private toHttpException(error: unknown, canWrite: boolean): Error {
    if (error instanceof ShipmentNotFoundException) {
      return new NotFoundException(error.message);
    }
    if (error instanceof ShipmentNotCancellableException) {
      return new ConflictException(error.message);
    }
    if (error instanceof ShipmentDispatchContendedException) {
      // A concurrent dispatch holds the per-order lock and has not persisted a
      // shipment yet (#1917). Retryable, and crucially "nothing was charged" —
      // this attempt never reached the carrier. 409 rather than the
      // unclassified 500 path so the operator is told that, instead of being
      // left to guess whether a label was bought.
      return new ConflictException(error.message);
    }
    if (error instanceof InvalidProtocolBatchException) {
      // Client-input problem (empty set / no labels / mixed carriers) → 400.
      return new BadRequestException(error.message);
    }
    if (
      error instanceof ShipmentCancellationNotSupportedException ||
      error instanceof UndispatchableResolutionException ||
      error instanceof OrderNotDispatchablePaymentStatusException ||
      // #2339 — the hold gate. 422 like its payment-status sibling: the request
      // is well-formed, the order's persisted state refuses it, and the remedy
      // (release the hold) is the operator's, not the client's.
      error instanceof OrderNotDispatchableHeldException ||
      error instanceof LabelDocumentNotSupportedException ||
      error instanceof LabelNotAvailableException ||
      error instanceof DispatchProtocolNotSupportedException
    ) {
      return new UnprocessableEntityException(error.message);
    }
    if (error instanceof ShippingProviderAuthException) {
      // The carrier rejected OUR stored credentials (401/403) — an upstream
      // configuration problem, not an OL fault. Map to 502 (same family as a
      // provider rejection) and explicitly NOT the "Unclassified" 500 path, so
      // operators see "carrier rejected us" rather than "OpenLinker crashed".
      // Flipping the connection to `needs_reauth` via the #819 auth-failure
      // classifier registry is a tracked follow-up.
      return new BadGatewayException(error.message);
    }
    if (error instanceof ShippingProviderRejectionException) {
      // Surface the carrier's structured rejection so the client sees WHICH
      // field the provider rejected, not just a generic message (#1428). The
      // provider-details payload is field-error metadata by convention — never
      // credentials, but it CAN echo the rejected address fragment, which is
      // exactly what `errorMessage` withholds from a viewer (#1826). Keep
      // `providerCode` either way: it is a stable, non-PII support reference.
      return new BadGatewayException({
        message: canWrite ? error.message : REDACTED_ERROR_MESSAGE,
        providerCode: error.providerCode,
        details: canWrite ? error.providerDetails : undefined,
      });
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

/**
 * Map a label document's MIME type to a download-filename extension. The label
 * bytes are NOT always PDF — Allegro returns ZPL/EPL per the seller's "Ship
 * with Allegro" setting, InPost ShipX can return PNG, and a multi-service
 * dispatch protocol comes back as a ZIP — so the saved file must be labelled
 * by its actual content type, never hardcoded to `.pdf`.
 * Falls back to `bin` for anything unrecognised so the download never claims a
 * format it isn't.
 */
export function extensionForContentType(contentType: string): string {
  const ct = contentType.toLowerCase().split(';', 1)[0].trim();
  switch (ct) {
    case 'application/pdf':
      return 'pdf';
    case 'image/png':
      return 'png';
    case 'application/zpl':
    case 'application/x-zpl':
    case 'text/zpl':
      return 'zpl';
    case 'application/epl':
    case 'application/x-epl':
      return 'epl';
    case 'application/zip':
      return 'zip';
    default:
      return 'bin';
  }
}
