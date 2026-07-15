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
 * we never declare a redundant `@UseGuards(JwtAuthGuard)`. Reads carry no
 * `@Roles` (open to any authenticated role, including viewer); writes carry
 * their own `@Roles('admin')` (#1357, mirroring the #1124 read-open/write-gated
 * pattern).
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
  ParseUUIDPipe,
  type PipeTransform,
  HttpCode,
  HttpStatus,
  Inject,
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  NotImplementedException,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiProduces, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { Logger } from '@openlinker/shared/logging';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
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
  toIssueInvoiceCommand,
  InvalidBuyerProfileError,
  InvalidInvoiceLineError,
  UnsupportedPriceTreatmentError,
  DuplicateInvoiceRecordException,
  InvoiceRecordNotFoundException,
  RegulatoryDocumentKindValues,
  UnsupportedRegulatoryDocumentKindError,
  isRegulatoryDocumentReader,
  isRegulatoryResubmitter,
  BuyerProfile,
  isBankAccountsReader,
  isBankAccountDefaultSetter,
  isInvoiceEmailSender,
  isPaymentMarker,
  PAYMENT_STATUS_REFRESH_SERVICE_TOKEN,
  IPaymentStatusRefreshService,
  normalizeShippingLineName,
} from '@openlinker/core/invoicing';
import type {
  InvoiceRecord,
  IssueInvoiceCommand,
  InvoiceRecordFilters,
  IssuedLineSnapshot,
  OriginalDocumentSnapshot,
  TaxIdentifier,
  InvoicingPort,
  RegulatoryDocumentKind,
  RegulatoryClearanceResult,
  StoredDocument,
} from '@openlinker/core/invoicing';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  IOrderRecordService,
  orderFromReadySnapshot,
  OrderSnapshotUnavailableError,
} from '@openlinker/core/orders';
import type { Order, OrderRecord } from '@openlinker/core/orders';
import {
  CONNECTION_PORT_TOKEN,
  ConnectionPort,
} from '@openlinker/core/identifier-mapping';
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
import { BulkIssueInvoicesRequestDto } from './dto/bulk-issue-invoices-request.dto';
import { BulkIssueInvoicesResponseDto } from './dto/bulk-issue-invoices-response.dto';
import type { BulkIssueInvoiceResultDto } from './dto/bulk-issue-invoices-response.dto';
import { BankAccountResponseDto } from './dto/bank-account-response.dto';
import { SendInvoiceEmailRequestDto } from './dto/send-invoice-email-request.dto';
import { SendInvoiceEmailResponseDto } from './dto/send-invoice-email-response.dto';
import { MarkInvoicePaidRequestDto } from './dto/mark-invoice-paid-request.dto';

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

/** Shared `:invoiceId` param pipe — 404 (not 400) on a malformed UUID, consistently across every route. */
function invoiceIdPipe(): ParseUUIDPipe {
  return new ParseUUIDPipe({ version: '4', errorHttpStatusCode: 404 });
}

/** Shared `:connectionId` param pipe — 400 on a malformed UUID, so a bad path id never reaches the DB uuid cast (#1313). */
function connectionIdPipe(): ParseUUIDPipe {
  return new ParseUUIDPipe({ version: '4' });
}

/**
 * `:accountId` param pipe — 400 on an empty/whitespace id (#1310 review). The
 * adapter already `encodeURIComponent`s the id before the provider PUT, so this
 * is a contract guard (a blank segment never reaches the provider), not the
 * injection defence, and it holds for any future `BankAccountDefaultSetter`.
 */
function accountIdPipe(): PipeTransform<string, string> {
  return {
    transform(value: string): string {
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new BadRequestException('accountId must be a non-empty string');
      }
      return value;
    },
  };
}

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
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(PAYMENT_STATUS_REFRESH_SERVICE_TOKEN)
    private readonly paymentStatusRefreshService: IPaymentStatusRefreshService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
  ) {}

  @Get('connections/:connectionId/bank-accounts')
  @ApiOperation({
    summary: "List the connection's provider bank accounts (#1303 follow-up)",
    description:
      "Resolves the connection's Invoicing adapter and, if it implements BankAccountsReader, " +
      "returns the seller's payable bank accounts (e.g. for picking one to stamp on Transfer " +
      'invoices). 501 when the adapter has no bank-account concept.',
  })
  @ApiResponse({ status: 200, type: [BankAccountResponseDto] })
  @ApiResponse({ status: 404, description: 'Connection not found or has no Invoicing adapter' })
  @ApiResponse({ status: 501, description: 'Adapter does not implement BankAccountsReader' })
  @ApiResponse({ status: 502, description: 'Invoicing provider unavailable or call failed' })
  async getBankAccounts(
    @Param('connectionId', connectionIdPipe()) connectionId: string,
  ): Promise<BankAccountResponseDto[]> {
    const adapter = await this.resolveInvoicingAdapter(connectionId);
    if (!isBankAccountsReader(adapter)) {
      throw new NotImplementedException(
        `Adapter for connection ${connectionId} does not implement BankAccountsReader`,
      );
    }
    try {
      const accounts = await adapter.listBankAccounts();
      return accounts.map((account) => ({
        id: account.id,
        accountNumber: account.accountNumber,
        bankName: account.bankName,
        isDefault: account.isDefault,
      }));
    } catch (error) {
      throw this.toProviderBadGateway(error, 'listBankAccounts', connectionId);
    }
  }

  @Roles('admin')
  @Post('connections/:connectionId/bank-accounts/:accountId/default')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Mark a bank account as the provider's default (#1303 follow-up)",
    description:
      "Resolves the connection's Invoicing adapter and, if it implements " +
      'BankAccountDefaultSetter, marks accountId as the default with the provider (e.g. ' +
      "inFakt's own account settings) — keeps the provider's default in sync with the " +
      "account OpenLinker stamps on Transfer invoices. 501 when the adapter doesn't support it.",
  })
  @ApiResponse({ status: 204, description: 'Default account updated' })
  @ApiResponse({ status: 404, description: 'Connection not found or has no Invoicing adapter' })
  @ApiResponse({ status: 501, description: 'Adapter does not implement BankAccountDefaultSetter' })
  @ApiResponse({ status: 502, description: 'Invoicing provider unavailable or call failed' })
  async setDefaultBankAccount(
    @Param('connectionId', connectionIdPipe()) connectionId: string,
    @Param('accountId', accountIdPipe()) accountId: string,
  ): Promise<void> {
    const adapter = await this.resolveInvoicingAdapter(connectionId);
    if (!isBankAccountDefaultSetter(adapter)) {
      throw new NotImplementedException(
        `Adapter for connection ${connectionId} does not implement BankAccountDefaultSetter`,
      );
    }
    try {
      await adapter.setDefaultBankAccount(accountId);
    } catch (error) {
      throw this.toProviderBadGateway(error, 'setDefaultBankAccount', connectionId);
    }
  }

  /**
   * Resolve the connection's Invoicing adapter for the bank-account proxy
   * endpoints. `AdapterNotFoundException` → 502 (provider unavailable),
   * mirroring the issuance path's mapping, instead of surfacing as a generic
   * 500; connection / capability-configuration errors propagate uncaught for
   * the global filter to classify (404 etc.).
   */
  private async resolveInvoicingAdapter(connectionId: string): Promise<InvoicingPort> {
    try {
      return await this.integrationsService.getCapabilityAdapter<InvoicingPort>(
        connectionId,
        'Invoicing',
      );
    } catch (error) {
      if (error instanceof AdapterNotFoundException) {
        throw new BadGatewayException('Invoicing provider is unavailable');
      }
      throw error;
    }
  }

  /**
   * Resolve the connection's optional operator-supplied shipping-line label
   * (#1562) to thread into `toIssueInvoiceCommand`. Country-agnostic (ADR-026):
   * core forwards an opaque operator string, never a language it chose, and
   * never switches on `platformType`. Narrowed to a non-empty string so a
   * non-string / blank JSONB value defers to the mapper's neutral
   * `SHIPPING_LINE_NAME` default. Resilient by design: any connection-lookup
   * failure returns `undefined` (neutral label) rather than breaking issuance -
   * the adapter resolution downstream is the authoritative connection gate.
   */
  private async resolveShippingLineName(connectionId: string): Promise<string | undefined> {
    try {
      const connection = await this.connectionPort.get(connectionId);
      // Shared coercion with the core auto-issue reader so the two narrowings
      // cannot drift (#1565 review).
      return normalizeShippingLineName(connection.config.invoicing?.shippingLineName);
    } catch (error) {
      // Silent fallback is intentional and safe: issuance must never break on a
      // label lookup (the downstream getCapabilityAdapter is the authoritative
      // connection gate). Log at debug so an unexpected connection-read failure
      // is still observable rather than swallowed entirely.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(
        `Shipping-line label lookup failed for connection ${connectionId}; using neutral default: ${message}`,
      );
      return undefined;
    }
  }

  /**
   * These endpoints are pure provider proxies, so a live provider call
   * failing is upstream trouble, not a server bug — map it to 502 with a
   * generic message. Provider error text is logged, never returned (same PII
   * posture as `toHttpException`) — but `sendByEmail` in particular emails
   * buyers, so a provider error can itself embed the buyer's address (e.g.
   * "inFakt 500: buyer bob@secret.pl"). Email-shaped substrings are scrubbed
   * before the message ever reaches the logger, and the optional `contextId`
   * (invoice/connection id) lets an operator correlate the log line without
   * needing the raw provider text.
   */
  private toProviderBadGateway(error: unknown, operation: string, contextId?: string): Error {
    const message = error instanceof Error ? error.message : String(error);
    // Best-effort PII scrub for logging hygiene, not exhaustive RFC 5322
    // validation — quoted-string / special-character local-parts won't match.
    const scrubbed = message.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted-email]');
    const suffix = contextId ? ` (${contextId})` : '';
    this.logger.warn(`Invoicing provider ${operation} failed${suffix}: ${scrubbed}`);
    return new BadGatewayException('Invoicing provider request failed');
  }

  @Roles('admin')
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

    // #1562: thread the connection's operator-supplied shipping-line label into
    // the mapper (ADR-026 neutral - core forwards an opaque string). Blank/absent
    // defers to the mapper's neutral `SHIPPING_LINE_NAME` default.
    const shippingLineName = await this.resolveShippingLineName(dto.connectionId);

    let command: IssueInvoiceCommand;
    try {
      command = toIssueInvoiceCommand({
        order,
        connectionId: dto.connectionId,
        buyerTaxId: this.toTaxIdentifier(dto.buyerTaxId),
        documentType: dto.documentType,
        idempotencyKey,
        shippingLineName,
        // #1580: operator-supplied buyer classification → provider JST/GV.
        buyerIsPublicSectorEntity: dto.buyerIsPublicSectorEntity,
        buyerIsVatGroupMember: dto.buyerIsVatGroupMember,
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

  @Roles('admin')
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
        // #1562: same operator-supplied shipping-line label as the single-issue path.
        shippingLineName: await this.resolveShippingLineName(record.connectionId),
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

  @Roles('admin')
  @Post('invoices/bulk-issue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bulk-issue invoices for a list of orders (#1355)',
    description:
      'Issues invoices for a set of order ids on one invoicing connection, fanning ' +
      'out over the SAME single-order issue primitive `POST /invoices` composes (no ' +
      'parallel bulk pipeline). Idempotent per (connection, order) via the ' +
      'deterministic key `invoice:{connectionId}:{orderId}` (same key the auto-issue ' +
      'trigger uses), so a re-submitted batch does not double-issue. Orders already ' +
      'issued / in progress are skipped; a per-order failure is captured without ' +
      'aborting the rest. At most 100 order ids per request. Returns a per-id summary ' +
      '(partial-completion feedback). The provider adapter self-paces its own per-hour ' +
      'rate-limit ceilings (#1594), so a large batch throttles itself rather than ' +
      'relying solely on reactive backoff.',
  })
  @ApiResponse({ status: 200, description: 'Per-id issue summary', type: BulkIssueInvoicesResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error (empty array, blank ids, or batch > 100)' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async bulkIssueInvoices(
    @Body() dto: BulkIssueInvoicesRequestDto,
  ): Promise<BulkIssueInvoicesResponseDto> {
    // De-duplicate ids while preserving first-seen order so a caller that repeats
    // an id gets ONE outcome and the same order is never issued twice in a single
    // request (each attempt could otherwise re-cross the provider boundary).
    const uniqueOrderIds = [...new Set(dto.orderIds)];

    const results: BulkIssueInvoiceResultDto[] = [];
    for (const orderId of uniqueOrderIds) {
      results.push(await this.issueOneForOrder(dto.connectionId, orderId));
    }

    const issued = results.filter((r) => r.outcome === 'issued').length;
    const skipped = results.filter((r) => r.outcome === 'skipped').length;
    // Partial-completion feedback (#1594): every id is processed and reported
    // per-outcome (no all-or-nothing), with `total` as the progress denominator.
    // Live streaming progress for very large batches is a documented follow-up;
    // the max-100 cap bounds the synchronous call duration until then.
    return {
      total: results.length,
      issued,
      skipped,
      failed: results.length - issued - skipped,
      results,
    };
  }

  /**
   * Issue an invoice for a SINGLE order on the given connection, reusing the exact
   * issue primitive `POST /invoices` composes (`toIssueInvoiceCommand` +
   * `invoiceService.issueInvoice`). Never throws — every branch, including the
   * order/invoice lookups, is inside the try so an infra blip on any one id
   * cannot abort the batch:
   *   - order record not found                    -> failed (not-found).
   *   - existing invoice `issued`                 -> skipped (already issued),
   *     carrying the existing row's id — the idempotent path.
   *   - existing `pending` / LIVE `issuing` lease  -> skipped (in progress).
   *   - otherwise (`failed` / expired lease / none) -> rebuild the command from the
   *     order snapshot and issue, keyed by the deterministic
   *     `invoice:{connectionId}:{orderId}` so a re-submitted batch resumes/dedups
   *     THAT row rather than double-issuing.
   *
   * The buyer tax id is NOT supplied per-order in a bulk request (mirrors a keyless
   * single re-issue), so the rebuilt command derives the buyer from the order
   * snapshot alone (`buyerTaxId: null`). A `DuplicateInvoiceRecordException` (a
   * concurrent bulk/auto-issue race on the same deterministic key) is semantically
   * "already in progress" and reported `skipped`, not `failed`. Any other
   * rehydration failure or provider rejection is captured as `failed` with a
   * neutral, PII-free correlation id — the raw provider/PII text is never returned.
   */
  private async issueOneForOrder(
    connectionId: string,
    orderId: string,
  ): Promise<BulkIssueInvoiceResultDto> {
    try {
      const record = await this.orders.getOrderRecord(orderId);
      if (!record) {
        return { orderId, outcome: 'failed', reason: 'Order not found.' };
      }

      // Re-issue gate — same semantics as the single `POST /invoices` endpoint,
      // but downgraded from a thrown 409 to a per-id `skipped` so the batch
      // continues.
      const existing = await this.invoiceService.getInvoice({ orderId, connectionId });
      if (existing) {
        if (existing.status === 'issued') {
          return {
            orderId,
            outcome: 'skipped',
            invoiceId: existing.id,
            reason: 'An invoice is already issued for this order.',
          };
        }
        if (existing.status === 'pending' || existing.isLeaseLive(new Date())) {
          return { orderId, outcome: 'skipped', reason: 'Invoice issuance is already in progress.' };
        }
      }

      const order = this.rehydrateOrder(record.internalOrderId, record);
      // Deterministic per-(connection, order) key — the same key the auto-issue
      // trigger uses. Threading it into the service's exactly-once dedup gate is
      // what makes a re-submitted batch idempotent (an already-issued row is
      // returned verbatim; an in-flight one is not double-attempted).
      const idempotencyKey = `invoice:${connectionId}:${orderId}`;
      const command = toIssueInvoiceCommand({
        order,
        connectionId,
        // Bulk requests carry no per-order buyer tax id; derive from the order
        // snapshot alone (matches a keyless single re-issue).
        buyerTaxId: null,
        idempotencyKey,
        // #1562: same operator-supplied shipping-line label as the single-issue path.
        shippingLineName: await this.resolveShippingLineName(connectionId),
      });
      const issued = await this.invoiceService.issueInvoice(command);
      return { orderId, outcome: 'issued', invoiceId: issued.id };
    } catch (error) {
      if (error instanceof DuplicateInvoiceRecordException) {
        // Belt-and-suspenders. The primary dedup on the deterministic
        // `invoice:{connectionId}:{orderId}` key happens INSIDE
        // `InvoiceService.issueInvoice`: its read-gate resolves an existing
        // same-key row (returning an `issued` one verbatim, resuming a
        // non-terminal one), and a create-race is normally swallowed there too —
        // the service catches the duplicate, re-reads the winner, and resumes it.
        // This catch only fires in the residual race where that internal re-read
        // can't resolve a winner and the exception propagates. It is still
        // "already in progress/done", not a failure, and no double-issue results
        // either way, so report it as `skipped`.
        return {
          orderId,
          outcome: 'skipped',
          reason: 'Invoice issuance is already in progress.',
        };
      }
      // A rejection / rehydration / lookup failure for ONE order must not abort
      // the batch. Log the bounded internal diagnostic with a correlation id;
      // surface only a neutral, PII-free reason.
      const correlationId = `inv-bulk-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      this.logger.warn(
        `Bulk issue failed for order ${orderId} (${correlationId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        orderId,
        outcome: 'failed',
        reason: `Issuance failed; surfaced for manual review (correlationId: ${correlationId}).`,
      };
    }
  }

  @Roles('admin')
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
    @Param('invoiceId', invoiceIdPipe()) invoiceId: string,
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
    if (!original.providerInvoiceNumber || !original.issuedAt) {
      // Pre-#1338 rows issued before providerInvoiceNumber was persisted at
      // construction time need the one-off backfill migration
      // (1818000000004-backfill-ksef-provider-invoice-number.ts) to pass this check.
      throw new UnprocessableEntityException(
        `Invoice ${invoiceId} is missing document number / issue date — it may not be fully issued yet, ` +
          `or it was issued before the provider stamped its document number and needs a one-off backfill`,
      );
    }

    let issued: InvoiceRecord;
    try {
      // Some adapters (KSeF's FA(3) KOR) cannot correct via a delta — they must
      // resubmit a COMPLETE corrected document, which needs the original
      // document's buyer/currency/lines. Built UNCONDITIONALLY whenever it can be
      // — regardless of whether the resolved connection's adapter actually needs
      // it — rather than resolving the adapter here just to branch on it; adapters
      // that only need deltas (Subiekt) simply ignore the field.
      //
      // #1297: prefer the persisted issuance-time snapshot on the document being
      // corrected (`original.issuedLineSnapshot`) — which, for a correction-of-
      // correction, is the PRIOR correction's own post-correction lines, since
      // `original` is resolved by :invoiceId above. Only when no snapshot exists
      // (rows issued before this column) fall back to rebuilding from the order's
      // CURRENT state — the pre-#1297 behaviour, with its accepted line-fidelity
      // and `buyerTaxId: null` caveats (see `OriginalDocumentSnapshot`'s doc).
      let originalDocument: OriginalDocumentSnapshot | undefined;
      if (original.issuedLineSnapshot) {
        originalDocument = this.buildSnapshotFromRecord(original, original.issuedLineSnapshot);
      } else {
        const orderRecord = await this.orders.getOrderRecord(original.orderId);
        originalDocument = orderRecord
          ? this.buildOriginalDocumentSnapshot({
              orderRecord,
              connectionId: original.connectionId,
              documentType: original.documentType,
              clearanceReference: original.clearanceReference,
              documentNumber: original.providerInvoiceNumber,
              issuedAt: original.issuedAt,
              // #1562: same operator-supplied shipping-line label as the issuance
              // path. Best available approximation for this pre-#1297 rebuild
              // (which already carries line-fidelity caveats); the current
              // connection label matches what issuance would render today.
              shippingLineName: await this.resolveShippingLineName(original.connectionId),
            })
          : undefined;
      }

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
        originalDocument,
      });
    } catch (error) {
      throw this.toHttpException(error);
    }
    return this.toDto(issued);
  }

  @Roles('admin')
  @Post('invoices/:invoiceId/resend-to-ksef')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-send a rejected invoice to the tax authority (KSeF)',
    description:
      "Re-triggers transmission of an already-issued document whose clearance ended in " +
      "'rejected', then refreshes the stored regulatory status. Gated to rejected documents " +
      '(409 otherwise) to avoid racing an in-flight submission or re-sending a cleared document. ' +
      'Requires the connection adapter to implement the RegulatoryResubmitter sub-capability ' +
      '(501 when unsupported). Neutral by design (ADR-026) — the core capability carries no ' +
      'regime vocabulary; only this operator-facing route name references KSeF, mirroring /upo.',
  })
  @ApiResponse({ status: 200, description: 'Resubmitted; refreshed record', type: InvoiceRecordResponseDto })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  @ApiResponse({ status: 409, description: 'Invoice is not in a rejected state' })
  @ApiResponse({ status: 501, description: 'Adapter does not implement RegulatoryResubmitter' })
  @ApiResponse({ status: 502, description: 'Invoicing provider unavailable or the resend failed' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async resendToKsef(
    @Param('invoiceId', invoiceIdPipe()) invoiceId: string,
  ): Promise<InvoiceRecordResponseDto> {
    const record = await this.invoiceService.getInvoiceById(invoiceId);
    if (!record) {
      throw new NotFoundException(`Invoice not found: ${invoiceId}`);
    }
    // Gate: resend ONLY a terminal-rejected document. Re-sending an in-flight
    // (`submitted`) or already-`accepted` document would race the provider or
    // duplicate a cleared submission, so anything but `rejected` is a 409.
    if (record.regulatoryStatus !== 'rejected') {
      throw new ConflictException(
        `Invoice ${invoiceId} is not in a rejected state (regulatory status ${record.regulatoryStatus}); ` +
          'only rejected invoices can be re-sent',
      );
    }

    const adapter = await this.resolveInvoicingAdapter(record.connectionId);
    if (!isRegulatoryResubmitter(adapter)) {
      throw new NotImplementedException(
        `Adapter for connection ${record.connectionId} does not implement RegulatoryResubmitter`,
      );
    }

    // No OL-side concurrency lease here (unlike the issue path's CAS lease): two
    // concurrent admin clicks both read `rejected` and both re-hit the provider.
    // That is intentional and safe — `resubmitForClearance` only re-sends the SAME
    // document by `providerInvoiceId` and never re-POSTs `invoices.json`, so it
    // cannot double-issue; resend relies on provider-side idempotency rather than
    // an OL lease.
    let result: RegulatoryClearanceResult;
    try {
      result = await adapter.resubmitForClearance(record);
    } catch (error) {
      // Only the provider call is a 502-worthy upstream fault. Keep the local
      // write outside this catch so a TOCTOU persistence failure isn't mislabelled
      // as a provider failure.
      throw this.toProviderBadGateway(error, 'resubmitForClearance');
    }

    // Refresh the stored regulatory status so the projection reflects the new
    // (typically `submitted`) state and the reconciliation sweep resumes polling.
    // The provider already succeeded; a failure here is a local persistence fault
    // (e.g. the record was deleted after the read), mapped on its own terms.
    try {
      const refreshed = await this.invoiceService.applyRegulatoryClearance(invoiceId, result);
      return this.toDto(refreshed);
    } catch (error) {
      if (error instanceof InvoiceRecordNotFoundException) {
        throw new NotFoundException(`Invoice not found: ${invoiceId}`);
      }
      throw this.toHttpException(error);
    }
  }

  @Roles('admin')
  @Post('invoices/:invoiceId/send-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Email an issued invoice to the buyer (#1353)',
    description:
      'Triggers the connection\'s Invoicing provider to render + email the issued document to ' +
      'the buyer (e.g. inFakt\'s deliver_via_email). OpenLinker only triggers the send — the ' +
      'provider composes and delivers the message to the buyer\'s stored email (no recipient ' +
      'override). Optional neutral locale (pl/en) and send-copy flag. 501 when the resolved ' +
      'adapter does not implement InvoiceEmailSender.',
  })
  @ApiResponse({ status: 200, description: 'Delivery triggered', type: SendInvoiceEmailResponseDto })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  @ApiResponse({ status: 422, description: 'Invoice not fully issued (no provider invoice id)' })
  @ApiResponse({ status: 501, description: 'Adapter does not implement InvoiceEmailSender' })
  @ApiResponse({ status: 502, description: 'Invoicing provider unavailable or call failed' })
  async sendInvoiceEmail(
    @Param('invoiceId', invoiceIdPipe()) invoiceId: string,
    @Body() dto: SendInvoiceEmailRequestDto,
  ): Promise<SendInvoiceEmailResponseDto> {
    const record = await this.invoiceService.getInvoiceById(invoiceId);
    if (!record) {
      throw new NotFoundException(`Invoice not found: ${invoiceId}`);
    }
    if (!record.providerInvoiceId) {
      throw new UnprocessableEntityException(
        `Invoice ${invoiceId} has no provider invoice id — it may not be fully issued yet`,
      );
    }

    const adapter = await this.resolveInvoicingAdapter(record.connectionId);
    if (!isInvoiceEmailSender(adapter)) {
      throw new NotImplementedException(
        `Adapter for invoice ${invoiceId} does not implement InvoiceEmailSender`,
      );
    }
    try {
      const result = await adapter.sendByEmail({
        externalInvoiceId: record.providerInvoiceId,
        locale: dto.locale,
        sendCopy: dto.sendCopy,
      });
      return { delivered: result.delivered, recipient: result.recipient };
    } catch (error) {
      throw this.toProviderBadGateway(error, 'sendByEmail', invoiceId);
    }
  }

  @Roles('admin')
  @Post('invoices/:invoiceId/mark-paid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Push an authoritative "paid" state to the provider (#1362)',
    description:
      'Marks an already-issued document as paid with the connection\'s Invoicing provider - ' +
      'the outbound counterpart to the payment-status webhook (#1354). Useful for orders ' +
      'settled before/outside the invoice itself (e.g. a marketplace order the buyer already ' +
      'paid the marketplace for), which a provider has no bank statement to auto-match ' +
      'against. After the provider accepts the mark, OL best-effort re-reads the payment ' +
      'status to refresh its own projection; the returned `paymentStatus` reflects that ' +
      'immediate re-read and may not yet show `paid` if the provider\'s own processing ' +
      'hasn\'t completed - this is not a failure. 501 when the resolved adapter does not ' +
      'implement PaymentMarker.',
  })
  @ApiResponse({ status: 200, description: 'Provider accepted the mark', type: InvoiceRecordResponseDto })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  @ApiResponse({ status: 422, description: 'Invoice not fully issued (no provider invoice id)' })
  @ApiResponse({ status: 501, description: 'Adapter does not implement PaymentMarker' })
  @ApiResponse({ status: 502, description: 'Invoicing provider unavailable or the mark failed' })
  async markInvoicePaid(
    @Param('invoiceId', invoiceIdPipe()) invoiceId: string,
    @Body() dto: MarkInvoicePaidRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InvoiceRecordResponseDto> {
    const record = await this.invoiceService.getInvoiceById(invoiceId);
    if (!record) {
      throw new NotFoundException(`Invoice not found: ${invoiceId}`);
    }
    if (!record.providerInvoiceId) {
      throw new UnprocessableEntityException(
        `Invoice ${invoiceId} has no provider invoice id - it may not be fully issued yet`,
      );
    }

    const adapter = await this.resolveInvoicingAdapter(record.connectionId);
    if (!isPaymentMarker(adapter)) {
      throw new NotImplementedException(
        `Adapter for invoice ${invoiceId} does not implement PaymentMarker`,
      );
    }

    // Proportionate sanity warnings (not hard blocks): the operator may be
    // asserting a financial fact that contradicts OL's own projection, so
    // surface it in the log rather than silently marking. Payment is normally
    // tracked on the original invoice, not on a correction document.
    if (record.documentType === 'corrected') {
      this.logger.warn(
        `Marking a correction document (invoice ${invoiceId}) as paid; payment is normally tracked on the original invoice, not its correction`,
      );
    }
    if (record.paymentStatus === 'paid' || record.paymentStatus === 'partially-paid') {
      this.logger.warn(
        `Invoice ${invoiceId} local payment status is already '${record.paymentStatus}' before marking paid; proceeding at operator request`,
      );
    }

    this.logger.log(
      `Marking invoice ${invoiceId} (connection=${record.connectionId}) as paid, requested by user ${user.id}`,
    );

    const paidDate = dto.paidDate ? new Date(dto.paidDate) : new Date();
    try {
      await adapter.markPaid({ externalInvoiceId: record.providerInvoiceId, paidDate });
    } catch (error) {
      throw this.toProviderBadGateway(error, 'markPaid', invoiceId);
    }

    // Best-effort refresh: the provider mark already succeeded above, so a
    // hiccup here (throw, or a non-throwing 'unchanged' outcome because the
    // provider's own async processing hasn't completed yet) must never fail
    // the request - there is no reconciliation sweep for payment status
    // today, so this immediate re-read is the only automatic attempt to
    // update OL's local projection.
    let projectionChanged = false;
    try {
      const result = await this.paymentStatusRefreshService.refreshByExternalId(
        record.connectionId,
        record.providerInvoiceId,
      );
      projectionChanged = result.outcome === 'updated';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Post-markPaid payment status refresh failed for invoice ${invoiceId}: ${message}`);
    }

    // Only re-read when the refresh actually wrote a new status; on 'unchanged'
    // / 'not-found' / 'unsupported' / a swallowed failure, `record` is already
    // current so a second query would be redundant.
    const refreshed = projectionChanged
      ? await this.invoiceService.getInvoiceById(invoiceId)
      : null;
    return this.toDto(refreshed ?? record);
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
   * ISO 8601 calendar date only (`YYYY-MM-DD`). Anchored to UTC (matches the
   * adapter-side `toIsoDate` precedent in `KsefInvoicingAdapter`) — a `Date`
   * close to local midnight in a UTC+ timezone can report the previous day's
   * calendar date. Acceptable here since the value only threads through as an
   * opaque correction-linkage field, never rendered to an operator directly.
   */
  private toIsoDateOnly(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  /**
   * Assemble `OriginalDocumentSnapshot` from the record's persisted issuance-time
   * line snapshot (#1297) — the PRIMARY path. `buyer`/`currency`/`lines` come from
   * the snapshot (the lines AS ISSUED, including the true buyer tax id — no
   * `buyerTaxId: null` caveat and no order fetch); `documentType`/clearance/number/
   * issue date come from the record itself. Transitional exception: a snapshot
   * persisted by a correction of a PRE-#1297 record was seeded from the fallback
   * reconstruction, so its `taxId` is `null` — a one-hop degradation that
   * self-heals for documents issued after the snapshot column existed. The
   * snapshot's `buyer` round-trips from jsonb as a plain structural object
   * (`IssuedSnapshotBuyer`), so it is re-wrapped into a real `BuyerProfile` to
   * match the fallback path's output shape.
   */
  private buildSnapshotFromRecord(
    record: InvoiceRecord,
    snapshot: IssuedLineSnapshot,
  ): OriginalDocumentSnapshot {
    const b = snapshot.buyer;
    return {
      buyer: new BuyerProfile(b.name, b.taxId, b.address, b.type),
      currency: snapshot.currency,
      documentType: record.documentType.length > 0 ? record.documentType : 'invoice',
      lines: snapshot.lines,
      clearanceReference: record.clearanceReference,
      // Non-null assertions (not `?? ''` / ternary fallbacks): the caller already
      // asserts `providerInvoiceNumber` and `issuedAt` are non-null before this
      // path runs, so masking a future guard regression behind an empty string
      // would silently produce an invalid document number / issue date instead
      // of surfacing the broken invariant.
      documentNumber: record.providerInvoiceNumber!,
      issueDate: this.toIsoDateOnly(record.issuedAt!),
    };
  }

  /**
   * FALLBACK (pre-#1297) reconstruction: rebuild the original document's
   * buyer/currency/lines from the order's CURRENT snapshot for records issued
   * before `issuedLineSnapshot` existed — mirrors `retryOne`'s keyless-re-issue
   * reconstruction. The buyer tax id is not recoverable this way, so it is
   * rebuilt as `buyerTaxId: null`, and lines reflect the order's current state
   * (see `OriginalDocumentSnapshot`'s doc comment for the line-fidelity caveat).
   * Takes a single options object (rather than positional params) so call
   * sites can't accidentally transpose two same-typed fields (e.g.
   * `documentNumber` / `clearanceReference`, both nullable strings).
   */
  private buildOriginalDocumentSnapshot(input: {
    orderRecord: OrderRecord;
    connectionId: string;
    documentType: string;
    clearanceReference: string | null;
    documentNumber: string;
    issuedAt: Date;
    shippingLineName?: string;
  }): OriginalDocumentSnapshot {
    const {
      orderRecord,
      connectionId,
      documentType,
      clearanceReference,
      documentNumber,
      issuedAt,
      shippingLineName,
    } = input;
    const order = this.rehydrateOrder(orderRecord.internalOrderId, orderRecord);
    const issueCmd = toIssueInvoiceCommand({
      order,
      connectionId,
      buyerTaxId: null,
      documentType: documentType.length > 0 ? documentType : undefined,
      shippingLineName,
    });
    return {
      buyer: issueCmd.buyer,
      currency: issueCmd.currency,
      documentType: issueCmd.documentType ?? 'invoice',
      lines: issueCmd.lines,
      clearanceReference,
      documentNumber,
      issueDate: this.toIsoDateOnly(issuedAt),
    };
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
      error instanceof InvalidInvoiceLineError ||
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
  async getContent(@Param('invoiceId', invoiceIdPipe()) invoiceId: string): Promise<IssuedDocumentContentDto> {
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
      'machine-readable source document — PL/KSeF: the FA(3) XML — served from the snapshot), ' +
      '`rendered` (a human-readable rendering, when the provider produces one server-side), or ' +
      '`confirmation` (the authority confirmation document — PL/KSeF: the UPO — equivalent to the ' +
      'dedicated `/upo` route). `kind` defaults to `source`. 400 on an unknown kind; 404 when the ' +
      'invoice id is unknown; 409 when the requested document is not available (not issued, no ' +
      'snapshot, or the provider cannot produce it).',
  })
  @ApiQuery({ name: 'kind', enum: ['source', 'rendered', 'confirmation'], required: false })
  @ApiProduces('application/xml', 'application/pdf', 'text/html')
  @ApiResponse({ status: 200, description: 'Document bytes (Content-Type per provider)' })
  @ApiResponse({ status: 400, description: 'Unknown document kind' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  @ApiResponse({ status: 409, description: 'Document not available for this invoice' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async downloadDocument(
    @Param('invoiceId', invoiceIdPipe()) invoiceId: string,
    @Res() res: Response,
    @Query('kind') kindParam?: string,
  ): Promise<void> {
    const kind = this.parseDocumentKind(kindParam);
    const record = await this.invoiceService.getInvoiceById(invoiceId);
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
  async downloadUpo(@Param('invoiceId', invoiceIdPipe()) invoiceId: string, @Res() res: Response): Promise<void> {
    const record = await this.invoiceService.getInvoiceById(invoiceId);
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
    try {
      const document = await adapter.getRegulatoryDocument(record, 'confirmation');
      this.streamBinaryDocument(res, invoiceId, 'confirmation', document.contentType, Buffer.from(document.content));
    } catch (error) {
      if (error instanceof UnsupportedRegulatoryDocumentKindError) {
        throw new ConflictException(
          `Invoice ${invoiceId} provider cannot produce a confirmation document`,
        );
      }
      throw error;
    }
  }

  // Declared last: must not shadow the more specific
  // `invoices/:invoiceId/upo` + `invoices/:invoiceId/content` sub-resources above.
  @Get('invoices/:invoiceId')
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
  async getInvoice(@Param('invoiceId', invoiceIdPipe()) invoiceId: string): Promise<InvoiceRecordResponseDto> {
    const record = await this.invoiceService.getInvoiceById(invoiceId);
    if (!record) {
      throw new NotFoundException(`Invoice not found: ${invoiceId}`);
    }
    return InvoiceRecordResponseDto.fromDomain(record);
  }

  /**
   * Narrow the `?kind=` query to a `RegulatoryDocumentKind`, defaulting to
   * `source`. `confirmation` is also reachable here (in addition to its
   * dedicated `/upo` alias) — any of the three neutral kinds is valid.
   */
  private parseDocumentKind(raw: string | undefined): RegulatoryDocumentKind {
    const value = raw ?? 'source';
    if ((RegulatoryDocumentKindValues as readonly string[]).includes(value)) {
      return value as RegulatoryDocumentKind;
    }
    throw new BadRequestException(
      `Unknown document kind '${value}'. Supported: ${RegulatoryDocumentKindValues.join(', ')}`,
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
    if (body.length > 20 * 1024 * 1024) {
      throw new ConflictException(
        `Document for invoice ${invoiceId} exceeds the 20 MB size limit (${body.length} bytes)`,
      );
    }
    const safeContentType = contentType.length > 0 ? contentType : 'application/octet-stream';
    const ext = extensionForContentType(safeContentType);
    res.setHeader('Content-Type', safeContentType);
    res.setHeader('Content-Disposition', `attachment; filename="ol-${kind}-${invoiceId}.${ext}"`);
    res.send(body);
  }
}
