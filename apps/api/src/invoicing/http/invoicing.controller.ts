/**
 * Invoicing Controller (#1119)
 *
 * HTTP REST surface for invoice issuance + reads. Composes the
 * `IssueInvoiceCommand` SERVER-SIDE from the core Order (the client never sends
 * buyer/lines); maps domain/adapter exceptions to operator-readable HTTP codes
 * without ever leaking internal/PII diagnostics.
 *
 * Also exposes the issued-document content snapshot
 * (`GET /invoices/:invoiceId/content`, §7.3 W2).
 *
 * Route ordering: the two-segment `/:invoiceId/upo` + `/:invoiceId/content` routes
 * are declared before the single-segment `/:invoiceId` so the more-specific
 * sub-resource paths always match first.
 *
 * THIN controller: reaches the orders context through `IOrderRecordService` and
 * the invoice projection through `IInvoiceService` — NEVER a repository port
 * (per architecture-overview.md § Cross-context dependencies in core).
 *
 * Also exposes the UPO download endpoint (#1224, epic #1142 C15): neutral by
 * design (ADR-026) — resolves the connection's `Invoicing` adapter, narrows to
 * the `RegulatoryDocumentReader` sub-capability, and streams back the document
 * blob without any KSeF/regime vocabulary.
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
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiProduces, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { Logger } from '@openlinker/shared/logging';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
  AdapterNotFoundException,
  CapabilityNotSupportedException,
  CapabilityNotEnabledException,
} from '@openlinker/core/integrations';
import {
  INVOICE_SERVICE_TOKEN,
  IInvoiceService,
  INVOICE_RECORD_REPOSITORY_TOKEN,
  InvoiceRecordRepositoryPort,
  toIssueInvoiceCommand,
  InvalidBuyerProfileError,
  UnsupportedPriceTreatmentError,
  DuplicateInvoiceRecordException,
  RegulatoryDocumentKindValues,
  UnsupportedRegulatoryDocumentKindError,
  isRegulatoryDocumentReader,
} from '@openlinker/core/invoicing';
import type {
  InvoiceRecord,
  IssueInvoiceCommand,
  InvoiceRecordFilters,
  TaxIdentifier,
  InvoicingPort,
  RegulatoryDocumentKind,
  StoredDocument,
} from '@openlinker/core/invoicing';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  IOrderRecordService,
  orderFromReadySnapshot,
  OrderSnapshotUnavailableError,
} from '@openlinker/core/orders';
import type { Order, OrderRecord } from '@openlinker/core/orders';
import { IssueInvoiceRequestDto } from './dto/issue-invoice-request.dto';
import { IssueCorrectionRequestDto } from './dto/issue-correction-request.dto';
import { GetInvoiceForOrderQueryDto } from './dto/get-invoice-for-order-query.dto';
import { ListInvoicesQueryDto } from './dto/list-invoices-query.dto';
import { InvoiceRecordResponseDto } from './dto/invoice-record-response.dto';
import { IssuedDocumentContentDto } from './dto/issued-document-content.dto';
import { PaginatedInvoicesResponseDto } from './dto/paginated-invoices-response.dto';
import { RetryInvoicesRequestDto } from './dto/retry-invoices-request.dto';
import { RetryInvoicesResponseDto } from './dto/retry-invoices-response.dto';
import type { RetryInvoiceResultDto } from './dto/retry-invoices-response.dto';

/** MIME → download-filename extension; the UPO is labelled by its real content type. */
const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'text/html': 'html',
};

function extensionForContentType(contentType: string): string {
  const mime = contentType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  return EXTENSION_BY_CONTENT_TYPE[mime] ?? 'bin';
}

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
    @Inject(INVOICE_RECORD_REPOSITORY_TOKEN)
    private readonly invoiceRecordRepository: InvoiceRecordRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
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
    // `failed`; reject `issued` (already done) and an in-progress attempt —
    // `pending`, or `issuing` under a LIVE CAS lease (#1200) — as 409.
    const existing = await this.invoiceService.getInvoice({
      orderId: dto.orderId,
      connectionId: dto.connectionId,
    });
    if (existing) {
      if (existing.status === 'issued') {
        throw new ConflictException(`Invoice already issued for order: ${dto.orderId}`);
      }
      // `pending` (intent persisted, not yet claimed) and a LIVE `issuing` lease
      // (an attempt currently crossing the provider boundary) are both "in
      // progress". A re-issue must NOT be reported as a fresh 201 success while an
      // original attempt is in flight (#1200) — surface 409 so the caller retries
      // later. An EXPIRED `issuing` lease falls through: it is re-claimable below.
      if (existing.status === 'pending' || existing.isLeaseLive(new Date())) {
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

  @Post('invoices/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Batch re-attempt failed invoice issuances',
    description:
      'Re-attempts ONLY records that are retry-eligible (status=failed AND ' +
      'failureMode=rejected — a terminal rejection where the provider created no ' +
      'document). Issued / issuing / pending / in-doubt / unknown ids are skipped ' +
      'server-side with a neutral per-id reason, never re-issued. Reuses the ' +
      'single-invoice issue/retry primitive per id (no parallel bulk pipeline). ' +
      'At most 100 ids per request. Returns a per-id outcome summary.',
  })
  @ApiResponse({ status: 200, description: 'Per-id retry summary', type: RetryInvoicesResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error (empty array, non-UUID ids, or batch > 100)' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async retryInvoices(@Body() dto: RetryInvoicesRequestDto): Promise<RetryInvoicesResponseDto> {
    // De-duplicate ids while preserving first-seen order so a caller that repeats
    // an id gets ONE outcome and the same id is never re-attempted twice in a
    // single request (a second attempt could cross the provider boundary again).
    const uniqueIds = [...new Set(dto.invoiceIds)];

    const results: RetryInvoiceResultDto[] = [];
    for (const invoiceId of uniqueIds) {
      results.push(await this.retryOne(invoiceId));
    }

    const retried = results.filter((r) => r.outcome === 'retried').length;
    return { retried, skipped: results.length - retried, results };
  }

  /**
   * Re-attempt a SINGLE invoice record by id, reusing the exact issue/retry
   * primitive the manual `POST /invoices` endpoint uses. Server-side eligibility
   * gate (NEVER re-issues a non-eligible record):
   *   - record not found                          -> skipped (not-found).
   *   - NOT `isReattemptableFailure`              -> skipped (status/<failureMode>):
   *     this excludes `issued`, `issuing`, `pending`, and `in-doubt` `failed` rows.
   *   - eligible (`failed` + `rejected`)          -> rebuild the command from the
   *     order snapshot (reusing the record's own idempotencyKey so the service
   *     resumes THAT row, R2/R3) and call `issueInvoice`. A provider re-rejection
   *     or rehydration failure is captured as `skipped` with a neutral reason — it
   *     must NOT abort the rest of the batch, and the raw provider/PII text is
   *     never returned.
   *
   * The buyer tax id is NOT recoverable from the `InvoiceRecord` projection (it is
   * supplied per-request to the single endpoint and not persisted), so the rebuilt
   * command derives the buyer from the order snapshot alone (`buyerTaxId: null`),
   * matching a keyless re-issue through `POST /invoices`.
   */
  private async retryOne(invoiceId: string): Promise<RetryInvoiceResultDto> {
    const record = await this.invoiceService.getInvoiceById(invoiceId);
    if (!record) {
      return { id: invoiceId, outcome: 'skipped', reason: 'Invoice record not found.' };
    }
    if (!record.isReattemptableFailure) {
      return {
        id: invoiceId,
        outcome: 'skipped',
        reason: `Not retry-eligible (status=${record.status}, failureMode=${record.failureMode ?? 'none'}).`,
      };
    }

    const orderRecord = await this.orders.getOrderRecord(record.orderId);
    if (!orderRecord) {
      return {
        id: invoiceId,
        outcome: 'skipped',
        reason: 'The order backing this invoice is no longer available.',
      };
    }

    try {
      // Use the OrderRecord's own internalOrderId for the rehydration error
      // message, matching the single-issue path's argument (record.orderId is the
      // same value, but this keeps the two call sites consistent).
      const order = this.rehydrateOrder(orderRecord.internalOrderId, orderRecord);
      const command = toIssueInvoiceCommand({
        order,
        connectionId: record.connectionId,
        // The projection does not persist the scheme-tagged buyer tax id; rebuild
        // from the order snapshot alone (matches a keyless single re-issue).
        buyerTaxId: null,
        // Pass the record's neutral documentType through when it carried one
        // (''/empty means "let the adapter derive it", as on the pending row).
        documentType: record.documentType.length > 0 ? record.documentType : undefined,
        // Reuse the record's OWN key so the service resumes THIS row rather than
        // starting a fresh attempt (R2/R3, exactly-once dedup).
        idempotencyKey: record.idempotencyKey ?? undefined,
      });
      await this.invoiceService.issueInvoice(command);
      return { id: invoiceId, outcome: 'retried' };
    } catch (error) {
      // A re-rejection / rehydration failure for ONE id must not abort the batch.
      // Log the bounded internal diagnostic with a correlation id; surface only a
      // neutral, PII-free reason referencing that id.
      const correlationId = `inv-retry-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      this.logger.warn(
        `Batch retry failed for invoice ${invoiceId} (${correlationId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        id: invoiceId,
        outcome: 'skipped',
        reason: `Re-attempt failed; surfaced for manual review (correlationId: ${correlationId}).`,
      };
    }
  }

  @Post('invoices/:invoiceId/correct')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Issue a correction of an already-issued invoice',
    description:
      'Issues a correcting document (faktura korygująca / credit-note) for the invoice ' +
      'identified by :invoiceId. The original InvoiceRecord is resolved server-side to ' +
      'extract connectionId, orderId, and originalProviderInvoiceId. Requires the ' +
      'connection adapter to implement the CorrectionIssuer sub-capability.',
  })
  @ApiResponse({ status: 201, description: 'Correction invoice issued', type: InvoiceRecordResponseDto })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  @ApiResponse({ status: 422, description: 'Provider rejected the correction or adapter does not support corrections' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async issueCorrection(
    @Param('invoiceId') invoiceId: string,
    @Body() dto: IssueCorrectionRequestDto,
  ): Promise<InvoiceRecordResponseDto> {
    const original = await this.invoiceService.getInvoiceById(invoiceId);
    if (!original) {
      throw new NotFoundException(`Invoice not found: ${invoiceId}`);
    }
    if (!original.providerInvoiceId) {
      throw new UnprocessableEntityException(
        `Invoice ${invoiceId} has no provider invoice id — it may not be fully issued yet`,
      );
    }

    let issued: InvoiceRecord;
    try {
      issued = await this.invoiceService.issueCorrection({
        connectionId: original.connectionId,
        orderId: original.orderId,
        originalProviderInvoiceId: original.providerInvoiceId,
        documentType: dto.lines.length > 0 ? 'corrected' : undefined,
        reason: dto.reason,
        lines: dto.lines.map((l) => ({
          originalLineNumber: l.originalLineNumber,
          newQuantity: l.newQuantity,
          newUnitPriceGross: l.newUnitPriceGross,
        })),
        idempotencyKey: dto.idempotencyKey,
      });
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
      'issued date range, and buyer-tax-id presence (taxId=with|without, #1202). ' +
      'The taxId filter is served by the neutral denormalized hasBuyerTaxId column ' +
      'on the projection (set on the write path), so no Order join is needed.',
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
      taxId: query.taxId,
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
    if (error instanceof DuplicateInvoiceRecordException) {
      return new ConflictException('An invoice record with this idempotency key already exists');
    }
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
      // W1 failure semantics (errorMessage stays omitted — PII).
      failureMode: record.failureMode,
      failureCode: record.failureCode,
      failureReason: record.failureReason,
      pdfUrl: record.pdfUrl,
      issuedAt: record.issuedAt ? record.issuedAt.toISOString() : null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  @Get('invoices/:invoiceId/content')
  @ApiOperation({
    summary: 'Get the issued-document content snapshot for an invoice',
    description:
      'Returns the neutral issued-document content (seller/buyer/lines/VAT/totals, §7.3) captured ' +
      'at issue time. 404 when the invoice id is unknown; 409 when the invoice carries no content ' +
      'snapshot yet (e.g. still pending, or issued by an adapter that did not capture content).',
  })
  @ApiResponse({ status: 200, description: 'Issued-document content', type: IssuedDocumentContentDto })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  @ApiResponse({ status: 409, description: 'No content snapshot available for this invoice' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getContent(@Param('invoiceId') invoiceId: string): Promise<IssuedDocumentContentDto> {
    const record = await this.invoiceService.getInvoiceById(invoiceId);
    if (!record) {
      throw new NotFoundException(`Invoice not found: ${invoiceId}`);
    }
    if (!record.documentContent) {
      throw new ConflictException(
        `No content snapshot is available for invoice ${invoiceId} (status ${record.status})`,
      );
    }
    return IssuedDocumentContentDto.fromDomain(record.documentContent);
  }

  @Get('invoices/:invoiceId/document')
  @ApiOperation({
    summary: 'Download a regulatory document for an invoice by neutral kind',
    description:
      'Returns the neutral document bytes for an issued invoice by `kind`: `source` (the persisted ' +
      'machine-readable source document — PL/KSeF: the FA(3) XML — served from the snapshot), or ' +
      '`rendered` (a human-readable rendering, when the provider produces one server-side). ' +
      '`kind` defaults to `source`. 400 on an unknown kind; 404 when the invoice id is unknown; ' +
      '409 when the requested document is not available (not issued, no snapshot, or the provider ' +
      'cannot produce it).',
  })
  @ApiQuery({ name: 'kind', enum: ['source', 'rendered'], required: false })
  @ApiProduces('application/xml', 'application/pdf', 'text/html')
  @ApiResponse({ status: 200, description: 'Document bytes (Content-Type per provider)' })
  @ApiResponse({ status: 400, description: 'Unknown document kind' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  @ApiResponse({ status: 409, description: 'Document not available for this invoice' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async downloadDocument(
    @Param('invoiceId') invoiceId: string,
    @Res() res: Response,
    @Query('kind') kindParam?: string,
  ): Promise<void> {
    const kind = this.parseDocumentKind(kindParam);
    const record = await this.invoiceRecordRepository.findById(invoiceId);
    if (!record) {
      throw new NotFoundException(`Invoice not found: ${invoiceId}`);
    }

    if (kind === 'source') {
      // The source document is core-persisted (snapshotted at issue) — served
      // straight from the record, no provider round-trip.
      if (!record.sourceDocument) {
        throw new ConflictException(
          `No source document is available for invoice ${invoiceId} (status ${record.status})`,
        );
      }
      this.streamStoredDocument(res, invoiceId, kind, record.sourceDocument);
      return;
    }

    // `rendered` (and any future provider-served kind) goes through the adapter.
    if (record.status !== 'issued' || record.regulatoryStatus !== 'accepted') {
      throw new ConflictException(
        `Document is not yet available for invoice ${invoiceId} (status ${record.status}, regulatory ${record.regulatoryStatus})`,
      );
    }
    const adapter = await this.integrationsService.getCapabilityAdapter<InvoicingPort>(
      record.connectionId,
      'Invoicing',
    );
    if (!isRegulatoryDocumentReader(adapter)) {
      throw new ConflictException(
        `Invoice ${invoiceId} provider does not expose downloadable documents`,
      );
    }
    try {
      const document = await adapter.getRegulatoryDocument(record, kind);
      this.streamBinaryDocument(res, invoiceId, kind, document.contentType, Buffer.from(document.content));
    } catch (error) {
      if (error instanceof UnsupportedRegulatoryDocumentKindError) {
        throw new ConflictException(
          `Invoice ${invoiceId} provider cannot produce a '${kind}' document`,
        );
      }
      throw error;
    }
  }

  @Get('invoices/:invoiceId/upo')
  @ApiOperation({
    summary: 'Download the authority confirmation document (UPO) for a cleared invoice',
    description:
      'Returns the neutral confirmation document bytes (XML/PDF, provider-dependent) for an ' +
      'issued + cleared invoice record. 404 when the invoice id is unknown; 409 when the document ' +
      'is not yet available (record not cleared, or its provider cannot return a confirmation).',
  })
  @ApiProduces('application/xml', 'application/pdf')
  @ApiResponse({ status: 200, description: 'UPO document bytes (Content-Type per provider)' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  @ApiResponse({ status: 409, description: 'UPO not yet available for this invoice' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async downloadUpo(@Param('invoiceId') invoiceId: string, @Res() res: Response): Promise<void> {
    const record = await this.invoiceRecordRepository.findById(invoiceId);
    if (!record) {
      throw new NotFoundException(`Invoice not found: ${invoiceId}`);
    }
    if (record.status !== 'issued' || record.regulatoryStatus !== 'accepted') {
      throw new ConflictException(
        `UPO is not yet available for invoice ${invoiceId} (status ${record.status}, regulatory ${record.regulatoryStatus})`,
      );
    }

    const adapter = await this.integrationsService.getCapabilityAdapter<InvoicingPort>(
      record.connectionId,
      'Invoicing',
    );
    if (!isRegulatoryDocumentReader(adapter)) {
      throw new ConflictException(
        `Invoice ${invoiceId} provider does not expose a confirmation document`,
      );
    }

    // `@Res()` disables Nest's serializer (binary, not JSON). The adapter call
    // runs FIRST so a thrown error still routes through the exception layer
    // before any byte is written; `res.*` only ever runs on success.
    const document = await adapter.getRegulatoryDocument(record, 'upo');
    this.streamBinaryDocument(res, invoiceId, 'upo', document.contentType, Buffer.from(document.content));
  }

  // Declared last: the single-segment `:invoiceId` route must not shadow the more
  // specific `/:invoiceId/upo` + `/:invoiceId/content` sub-resources above.
  @Get(':invoiceId')
  @ApiOperation({
    summary: 'Get an invoice record by id',
    description:
      'Returns the neutral full invoice record (status, provider ids, clearance, timestamps). ' +
      '404 when the invoice id is unknown. The rich issued-document content lives behind ' +
      '`GET /invoices/:invoiceId/content`.',
  })
  @ApiResponse({ status: 200, description: 'Invoice record', type: InvoiceRecordResponseDto })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getInvoice(@Param('invoiceId') invoiceId: string): Promise<InvoiceRecordResponseDto> {
    const record = await this.invoiceService.getInvoiceById(invoiceId);
    if (!record) {
      throw new NotFoundException(`Invoice not found: ${invoiceId}`);
    }
    return InvoiceRecordResponseDto.fromDomain(record);
  }

  /**
   * Narrow the `?kind=` query to a provider-fetched `RegulatoryDocumentKind`,
   * defaulting to `source`. `upo` has its own dedicated route, so the document
   * endpoint accepts only `source` | `rendered`; anything else is a 400.
   */
  private parseDocumentKind(raw: string | undefined): Exclude<RegulatoryDocumentKind, 'upo'> {
    const value = raw ?? 'source';
    if (value === 'source' || value === 'rendered') {
      return value;
    }
    throw new BadRequestException(
      `Unknown document kind '${value}'. Supported: ${RegulatoryDocumentKindValues.filter((k) => k !== 'upo').join(', ')}`,
    );
  }

  /** Stream a core-persisted {@link StoredDocument} (base64-decoded) as an attachment. */
  private streamStoredDocument(
    res: Response,
    invoiceId: string,
    kind: RegulatoryDocumentKind,
    document: StoredDocument,
  ): void {
    this.streamBinaryDocument(
      res,
      invoiceId,
      kind,
      document.contentType,
      Buffer.from(document.contentBase64, 'base64'),
    );
  }

  /**
   * Set the binary download headers and send. `@Res()` disables Nest's JSON
   * serializer; callers must run any throwing work BEFORE this so errors still
   * route through the exception layer before a byte is written.
   */
  private streamBinaryDocument(
    res: Response,
    invoiceId: string,
    kind: RegulatoryDocumentKind,
    contentType: string,
    body: Buffer,
  ): void {
    const safeContentType = contentType.length > 0 ? contentType : 'application/octet-stream';
    const ext = extensionForContentType(safeContentType);
    res.setHeader('Content-Type', safeContentType);
    res.setHeader('Content-Disposition', `attachment; filename="ol-${kind}-${invoiceId}.${ext}"`);
    res.send(body);
  }
}
