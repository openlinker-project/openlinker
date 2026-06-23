/**
 * Invoicing Controller (#1119)
 *
 * HTTP REST surface for invoice issuance + reads. Composes the
 * `IssueInvoiceCommand` SERVER-SIDE from the core Order (the client never sends
 * buyer/lines); maps domain/adapter exceptions to operator-readable HTTP codes
 * without ever leaking internal/PII diagnostics.
 *
 * THIN controller: reaches the orders context through `IOrderRecordService` and
 * the invoice projection through `IInvoiceService` — NEVER a repository port
 * (per architecture-overview.md § Cross-context dependencies in core).
 *
 * Guards are GLOBAL (auth.module APP_GUARD = JwtAuthGuard then RolesGuard), so
 * we declare only `@Roles('admin')` + `@ApiBearerAuth()` — never a redundant
 * `@UseGuards(JwtAuthGuard)`.
 *
 * @module apps/api/src/invoicing/http
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  Inject,
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Logger } from '@openlinker/shared/logging';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  INVOICE_SERVICE_TOKEN,
  IInvoiceService,
  toIssueInvoiceCommand,
  InvalidBuyerProfileError,
  UnsupportedPriceTreatmentError,
} from '@openlinker/core/invoicing';
import type {
  InvoiceRecord,
  IssueInvoiceCommand,
  InvoiceRecordFilters,
  TaxIdentifier,
} from '@openlinker/core/invoicing';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  IOrderRecordService,
  orderFromReadySnapshot,
  OrderSnapshotUnavailableError,
} from '@openlinker/core/orders';
import type { Order, OrderRecord } from '@openlinker/core/orders';
import {
  AdapterNotFoundException,
  CapabilityNotSupportedException,
  CapabilityNotEnabledException,
} from '@openlinker/core/integrations';
import { IssueInvoiceRequestDto } from './dto/issue-invoice-request.dto';
import { GetInvoiceForOrderQueryDto } from './dto/get-invoice-for-order-query.dto';
import { ListInvoicesQueryDto } from './dto/list-invoices-query.dto';
import { InvoiceRecordResponseDto } from './dto/invoice-record-response.dto';
import { PaginatedInvoicesResponseDto } from './dto/paginated-invoices-response.dto';

@Roles('admin')
@ApiBearerAuth()
@ApiTags('invoicing')
@Controller()
export class InvoicingController {
  private readonly logger = new Logger(InvoicingController.name);

  constructor(
    @Inject(INVOICE_SERVICE_TOKEN)
    private readonly invoiceService: IInvoiceService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orders: IOrderRecordService,
  ) {}

  @Post('invoices')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Manually issue or re-issue an invoice for an order',
    description:
      'Composes the IssueInvoiceCommand server-side from the order and delegates to IInvoiceService. Re-issue reuses the service idempotency semantics.',
  })
  @ApiResponse({ status: 201, description: 'Invoice issued', type: InvoiceRecordResponseDto })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 409, description: 'Invoice already issued or in progress' })
  @ApiResponse({ status: 422, description: 'Provider rejected the request' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async issueInvoice(@Body() dto: IssueInvoiceRequestDto): Promise<InvoiceRecordResponseDto> {
    // Load the core order record through the orders service seam (never the repo).
    const record = await this.orders.getOrderRecord(dto.orderId);
    if (!record) {
      throw new NotFoundException(`Order not found: ${dto.orderId}`);
    }

    // AC-5 re-issue gate. Read the order's CURRENT invoice projection on this
    // connection (single-row primitive — not the list query). Allow issuance
    // only when there is no record yet ("not issued") or the prior attempt
    // `failed`; reject `issued` (already done) and `pending` (in progress).
    const existing = await this.invoiceService.getInvoice({
      orderId: dto.orderId,
      connectionId: dto.connectionId,
    });
    if (existing) {
      if (existing.status === 'issued') {
        throw new ConflictException(`Invoice already issued for order: ${dto.orderId}`);
      }
      if (existing.status === 'pending') {
        throw new ConflictException(`Invoice issuance already in progress for order: ${dto.orderId}`);
      }
    }

    // Rehydrate the typed Order and compose the command server-side. The client
    // never supplies buyer/lines — they are derived from the order snapshot.
    const order = this.rehydrateOrder(record.internalOrderId, record);

    // Idempotency key selection. A caller-supplied key passes through verbatim
    // (the only way to reuse a SPECIFIC prior row through the service's
    // findByIdempotencyKey retry path, R2/R3).
    //
    // For a KEYLESS re-issue over a prior `failed` row we reuse that row's OWN
    // idempotencyKey when it carried one. We do NOT synthesize a brand-new key:
    // a first keyless issue persists the failed row with idempotencyKey=null
    // (invoice.service.ts), and the service dedups EXCLUSIVELY via
    // findByIdempotencyKey(connectionId, key) — a synthetic key the failed row
    // never carried would miss it and start a fresh attempt (a second provider
    // call + a duplicate row), contradicting AC-5's "re-issue reuses the
    // service's idempotency semantics". When the failed row is itself keyless
    // there is nothing to dedup against, so the re-issue is necessarily a fresh
    // keyless attempt (R1) — callers needing exactly-once must supply a key.
    const idempotencyKey =
      dto.idempotencyKey ??
      (existing && existing.status === 'failed' && existing.idempotencyKey !== null
        ? existing.idempotencyKey
        : undefined);

    let command: IssueInvoiceCommand;
    try {
      command = toIssueInvoiceCommand({
        order,
        connectionId: dto.connectionId,
        buyerTaxId: this.toTaxIdentifier(dto.buyerTaxId),
        documentType: dto.documentType,
        idempotencyKey,
      });
    } catch (error) {
      throw this.toHttpException(error);
    }

    let issued: InvoiceRecord;
    try {
      issued = await this.invoiceService.issueInvoice(command);
    } catch (error) {
      throw this.toHttpException(error);
    }
    return this.toDto(issued);
  }

  @Get('orders/:orderId/invoice')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get the invoice record for an order',
    description:
      'Reads the InvoiceRecord projection keyed by (orderId, connectionId). The ' +
      'invoicing `connectionId` is a REQUIRED query param — symmetric with how ' +
      'POST /invoices writes the row. It is NOT derivable from the order: an ' +
      'OrderRecord carries only its `sourceConnectionId` (the originating ' +
      'marketplace), which is a distinct capability from the Invoicing connection ' +
      'the invoice was issued on.',
  })
  @ApiResponse({ status: 200, description: 'Invoice record', type: InvoiceRecordResponseDto })
  @ApiResponse({ status: 404, description: 'Order or invoice not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getInvoiceForOrder(
    @Param('orderId') orderId: string,
    @Query() query: GetInvoiceForOrderQueryDto,
  ): Promise<InvoiceRecordResponseDto> {
    const record = await this.orders.getOrderRecord(orderId);
    if (!record) {
      throw new NotFoundException(`Order not found: ${orderId}`);
    }
    // The invoice projection is keyed (orderId, connectionId) where connectionId
    // is the INVOICING connection (the one POST stored), NOT the order's
    // sourceConnectionId (the marketplace). The order record carries no
    // invoicing-connection field, so the caller MUST supply it — same key POST
    // wrote the row under.
    const invoice = await this.invoiceService.getInvoice({
      orderId,
      connectionId: query.connectionId,
    });
    if (!invoice) {
      throw new NotFoundException(`No invoice for order: ${orderId}`);
    }
    return this.toDto(invoice);
  }

  @Get('invoices')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List invoice records',
    description:
      'Paginated list with AC-6 filters: status, connection, regulatory status, ' +
      'issued date range. The AC-6 "with/without tax id" sub-filter is NOT exposed ' +
      'here: the persisted InvoiceRecord projection has no buyer/tax-id column (the ' +
      'buyer lives on the Order), so it cannot be served without a schema migration ' +
      'that is out of #1119 scope. Tracked as a #1119 follow-up; not silently "done".',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated invoice list',
    type: PaginatedInvoicesResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async listInvoices(@Query() query: ListInvoicesQueryDto): Promise<PaginatedInvoicesResponseDto> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const filter: InvoiceRecordFilters = {
      status: query.status,
      connectionId: query.connectionId,
      regulatoryStatus: query.regulatoryStatus,
      issuedFrom: query.issuedFrom ? new Date(query.issuedFrom) : undefined,
      issuedTo: query.issuedTo ? new Date(query.issuedTo) : undefined,
    };
    const page = await this.invoiceService.listInvoices(filter, { limit, offset });
    return {
      items: page.items.map((record) => this.toDto(record)),
      total: page.total,
      limit,
      offset,
    };
  }

  /**
   * Rehydrate the typed Order from the persisted snapshot, surfacing the
   * PII-clean `OrderSnapshotUnavailableError` (not `ready`, or buyer redacted)
   * as a 422 with a generic message. The caller wraps mapper/service errors;
   * this keeps the rehydration failure mapped consistently.
   */
  private rehydrateOrder(orderId: string, record: OrderRecord): Order {
    try {
      return orderFromReadySnapshot(record);
    } catch (error) {
      if (error instanceof OrderSnapshotUnavailableError) {
        // PII-clean, generic 422 — never echo snapshot contents.
        throw new UnprocessableEntityException(
          `Order ${orderId} buyer details are unavailable for invoicing`,
        );
      }
      throw error;
    }
  }

  /** Map the optional B2B tax-id DTO onto the neutral, scheme-tagged identifier. */
  private toTaxIdentifier(
    dto: IssueInvoiceRequestDto['buyerTaxId'],
  ): TaxIdentifier | null {
    return dto ? { scheme: dto.scheme, value: dto.value } : null;
  }

  /**
   * Map issuance errors to operator-readable HTTP codes WITHOUT leaking
   * provider/PII diagnostics:
   *   - mapper pre-issue errors (bad buyer / net pricing) → 400 (client-fixable);
   *   - `OrderSnapshotUnavailableError` → 422 (generic buyer-unavailable);
   *   - `AdapterNotFoundException` → 502 (provider unavailable);
   *   - any other adapter rejection → 422 with a GENERIC message + correlation
   *     id (the provider/error text is logged internally, NEVER returned);
   *   - capability/connection-resolution errors propagate UNCAUGHT (handled by
   *     the global filter — they are not invoice-issuance rejections).
   */
  private toHttpException(error: unknown): Error {
    if (
      error instanceof InvalidBuyerProfileError ||
      error instanceof UnsupportedPriceTreatmentError
    ) {
      return new BadRequestException(error.message);
    }
    if (error instanceof OrderSnapshotUnavailableError) {
      return new UnprocessableEntityException('Order buyer details are unavailable for invoicing');
    }
    // Capability resolution / enablement errors are a connection-CONFIGURATION
    // fault, NOT an issuance rejection. Propagate them UNCAUGHT so the global
    // exception filter classifies them — do NOT mis-map to a generic 422.
    if (
      error instanceof CapabilityNotSupportedException ||
      error instanceof CapabilityNotEnabledException
    ) {
      return error;
    }
    if (error instanceof AdapterNotFoundException) {
      return new BadGatewayException('Invoicing provider is unavailable');
    }
    // Any other throw from the issuance path is an adapter rejection (the service
    // rethrows the raw provider error). Do NOT return it verbatim — it may carry
    // provider-echoed buyer PII. Log internally with a correlation id; return a
    // generic 422 referencing only that id.
    if (error instanceof Error) {
      const correlationId = `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      this.logger.warn(`Invoice issuance rejected (${correlationId}): ${error.message}`);
      return new UnprocessableEntityException(
        `Invoice issuance was rejected by the provider (correlationId: ${correlationId})`,
      );
    }
    return new UnprocessableEntityException('Invoice issuance was rejected by the provider');
  }

  /**
   * Explicit field projection (mirrors customers `toDto`): never spreads the
   * entity, and DELIBERATELY omits `idempotencyKey` + `errorMessage`.
   */
  private toDto(record: InvoiceRecord): InvoiceRecordResponseDto {
    return {
      id: record.id,
      connectionId: record.connectionId,
      orderId: record.orderId,
      providerType: record.providerType,
      documentType: record.documentType,
      status: record.status,
      providerInvoiceId: record.providerInvoiceId,
      providerInvoiceNumber: record.providerInvoiceNumber,
      regulatoryStatus: record.regulatoryStatus,
      clearanceReference: record.clearanceReference,
      pdfUrl: record.pdfUrl,
      issuedAt: record.issuedAt ? record.issuedAt.toISOString() : null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
