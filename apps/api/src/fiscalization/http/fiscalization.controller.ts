/**
 * Fiscalization Controller (#1908)
 *
 * HTTP surface for fiscal registration. Composes the `RegisterTransactionCommand`
 * SERVER-SIDE from the core order - the client never sends the sale lines - and
 * maps domain errors to operator-readable HTTP codes without leaking the
 * internal diagnostic.
 *
 * v1 registers on an EXPLICIT OPERATOR REQUEST and nothing else. OpenLinker never
 * decides whether an order legally requires a fiscal registration (ADR-042
 * decision 9); the seller and their accountant own that determination, and
 * automatic document routing is the sibling ADR-041 decision, deliberately
 * sequenced after this work.
 *
 * THIN controller: reaches orders through `IOrderRecordService` and fiscalization
 * through `IFiscalRegistrationService` - never a repository port.
 *
 * Guards are GLOBAL (`JwtAuthGuard` then `RolesGuard`), so no redundant
 * `@UseGuards` is declared. The read carries no `@Roles` (any authenticated
 * role); the two writes carry `@Roles('admin')`.
 *
 * @module apps/api/src/fiscalization/http
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  FISCAL_REGISTRATION_SERVICE_TOKEN,
  FiscalRegistrationContendedException,
  FiscalRegistrationNotInDoubtException,
  FiscalRegistrationRecordNotFoundException,
  IFiscalRegistrationService,
  InvalidFiscalLineError,
  MissingIdempotencyKeyException,
  OrderAlreadyHasInvoiceException,
  OrderAlreadyRegisteredException,
  UnsupportedFiscalPriceTreatmentError,
  toRegisterTransactionCommand,
} from '@openlinker/core/fiscalization';
import type {
  FiscalRegistrationRecord,
  RegisterTransactionCommand,
} from '@openlinker/core/fiscalization';
import {
  IOrderRecordService,
  ORDER_RECORD_SERVICE_TOKEN,
  OrderSnapshotUnavailableError,
  orderFromReadySnapshot,
} from '@openlinker/core/orders';
import type { Order, OrderRecord } from '@openlinker/core/orders';

import { Roles } from '../../auth/decorators/roles.decorator';
import { FiscalRegistrationResponseDto } from './dto/fiscal-registration-response.dto';
import { ReconcileFiscalRegistrationResponseDto } from './dto/reconcile-fiscal-registration-response.dto';
import { RegisterFiscalTransactionRequestDto } from './dto/register-fiscal-transaction-request.dto';

/**
 * The exactly-once key for this surface. One connection registering one order is
 * one sale, so this makes a repeated request - a double click, a retried fetch, a
 * duplicated job - idempotent BY CONSTRUCTION rather than by the caller
 * remembering to send a key.
 *
 * It is the ONLY key this endpoint can produce: the request DTO deliberately
 * carries no `idempotencyKey`, because a caller-chosen key would bypass the read
 * gate and register the same sale a second time. See the DTO for the full
 * reasoning; the mandatory-key contract of ADR-042 decision 6 lives at the
 * service boundary, which this function satisfies.
 */
function idempotencyKeyFor(connectionId: string, orderId: string): string {
  return `fiscal:${connectionId}:${orderId}`;
}

@ApiTags('fiscalization')
@ApiBearerAuth()
@Controller()
export class FiscalizationController {
  constructor(
    @Inject(FISCAL_REGISTRATION_SERVICE_TOKEN)
    private readonly fiscalRegistrations: IFiscalRegistrationService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orders: IOrderRecordService,
  ) {}

  @Roles('admin')
  @Post('fiscal-registrations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register an order`s sale with a fiscalization provider',
    description:
      'Composes the command server-side from the order and delegates to the core service, which ' +
      'owns the exactly-once guarantee. The exactly-once key is derived from (connection, order) ' +
      'and cannot be supplied by the caller, so a repeat resumes the existing record and can ' +
      'never produce a second registration of the same sale; an order that already carries a ' +
      'non-rejected registration is refused with 409 rather than registered again. ' +
      'Returns 200 with the record even when the attempt FAILED - an indeterminate outcome must ' +
      'be visibly indeterminate, and the caller needs the record id to reconcile against. Read ' +
      '`status` / `failureMode`, never the status code, to decide whether the sale was registered.',
  })
  @ApiResponse({ status: 200, description: 'Registration record', type: FiscalRegistrationResponseDto })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({
    status: 409,
    description: 'The order already carries a fiscal registration that is not terminally rejected',
  })
  @ApiResponse({ status: 422, description: 'The order cannot be composed into a registrable sale' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async register(
    @Body() dto: RegisterFiscalTransactionRequestDto,
  ): Promise<FiscalRegistrationResponseDto> {
    const record = await this.orders.getOrderRecord(dto.orderId);
    if (!record) {
      throw new NotFoundException(`Order not found: ${dto.orderId}`);
    }

    const order = this.rehydrateOrder(record.internalOrderId, record);

    let command: RegisterTransactionCommand;
    try {
      command = toRegisterTransactionCommand({
        order,
        connectionId: dto.connectionId,
        idempotencyKey: idempotencyKeyFor(dto.connectionId, dto.orderId),
      });
    } catch (error) {
      throw this.toHttpException(error);
    }

    let registered: FiscalRegistrationRecord;
    try {
      registered = await this.fiscalRegistrations.register(command);
    } catch (error) {
      throw this.toHttpException(error);
    }
    return this.toDto(registered);
  }

  @Get('fiscal-registrations')
  @ApiOperation({
    summary: 'List the fiscal registration records held by an order',
    description:
      'Newest-first, across every connection. Returns an empty list for an order nobody has asked ' +
      'to register - OpenLinker never asserts that an order requires a registration.',
  })
  @ApiResponse({ status: 200, type: [FiscalRegistrationResponseDto] })
  async listForOrder(
    @Query('orderId') orderId: string,
  ): Promise<FiscalRegistrationResponseDto[]> {
    if (typeof orderId !== 'string' || orderId.trim().length === 0) {
      throw new BadRequestException('orderId is required');
    }
    const records = await this.fiscalRegistrations.getByOrderId(orderId.trim());
    return records.map((record) => this.toDto(record));
  }

  @Roles('admin')
  @Post('fiscal-registrations/:id/reconcile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Settle an indeterminate registration by asking the provider',
    description:
      'The only sanctioned way out of an in-doubt outcome other than an operator decision. It ' +
      'looks the registration up at the provider by business coordinates - it is NEVER a resend, ' +
      'because resending a registration that already landed is the double registration this ' +
      'contract exists to prevent. A provider that cannot be queried reports "unsupported" and ' +
      'the record is left for the operator.',
  })
  @ApiResponse({ status: 200, type: ReconcileFiscalRegistrationResponseDto })
  @ApiResponse({ status: 404, description: 'Registration record not found' })
  @ApiResponse({ status: 409, description: 'The record is not an in-doubt failure' })
  async reconcile(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReconcileFiscalRegistrationResponseDto> {
    try {
      const result = await this.fiscalRegistrations.reconcileInDoubt(id);
      return { outcome: result.outcome, record: this.toDto(result.record) };
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  /**
   * Rehydrate the typed `Order` from the persisted snapshot. A snapshot that
   * cannot be rehydrated is a 422 with a generic message - never an echo of the
   * snapshot contents.
   *
   * `requireBuyer: false` because a fiscal registration NAMES NO BUYER. The
   * shared rehydrator's buyer gate is an invoicing rule (an invoice must carry a
   * buyer profile); applied here it made the whole capability unusable under
   * `OL_STORE_PII=false`, where every persisted address is `[REDACTED]` - every
   * attempt 422'd with no way forward - and it made `toRecipient`'s documented
   * "normal under a hash-only PII configuration" branch unreachable. Nothing
   * redacted leaks as a result: the command composer reads only `customerEmail`
   * (omitted entirely under hash-only mode) and `shippingAddress.phone` (absent
   * from a sanitized address), so the recipient simply resolves to `null`.
   */
  private rehydrateOrder(orderId: string, record: OrderRecord): Order {
    try {
      return orderFromReadySnapshot(record, { requireBuyer: false });
    } catch (error) {
      if (error instanceof OrderSnapshotUnavailableError) {
        throw new UnprocessableEntityException(
          `Order ${orderId} details are unavailable for fiscal registration`,
        );
      }
      throw error;
    }
  }

  private toHttpException(error: unknown): Error {
    if (error instanceof MissingIdempotencyKeyException) {
      return new BadRequestException(error.message);
    }
    if (
      error instanceof InvalidFiscalLineError ||
      error instanceof UnsupportedFiscalPriceTreatmentError
    ) {
      return new UnprocessableEntityException(error.message);
    }
    if (error instanceof FiscalRegistrationRecordNotFoundException) {
      return new NotFoundException(error.message);
    }
    if (
      error instanceof FiscalRegistrationNotInDoubtException ||
      error instanceof OrderAlreadyRegisteredException ||
      // #2157, ADR-041 §3a/3b: the order already has an INVOICE — a different
      // sales-document kind — on an invoicing connection; also a 409.
      error instanceof OrderAlreadyHasInvoiceException ||
      // #2157: a concurrent registration/issuance holds the per-order lock and
      // has persisted nothing yet — retryable, same 409 treatment.
      error instanceof FiscalRegistrationContendedException
    ) {
      return new ConflictException(error.message);
    }
    // Capability resolution / enablement faults are a connection CONFIGURATION
    // problem, not a registration rejection. Propagate them uncaught so the
    // global exception filter classifies them - do not mis-map to a generic 422.
    return error instanceof Error ? error : new Error(String(error));
  }

  /** Explicit allowlist projection; `errorMessage` is deliberately not exposed. */
  private toDto(record: FiscalRegistrationRecord): FiscalRegistrationResponseDto {
    return {
      id: record.id,
      connectionId: record.connectionId,
      orderId: record.orderId,
      providerType: record.providerType,
      idempotencyKey: record.idempotencyKey,
      status: record.status,
      providerReference: record.providerReference,
      documentReference: record.documentReference,
      signingIdentity: record.signingIdentity,
      registeredAt: record.registeredAt ? record.registeredAt.toISOString() : null,
      regimeExtras: record.regimeExtras,
      artefacts: record.artefacts,
      failureMode: record.failureMode,
      failureReason: record.failureReason,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
