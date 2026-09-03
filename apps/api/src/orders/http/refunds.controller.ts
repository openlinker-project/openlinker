/**
 * Refunds Controller
 *
 * HTTP write/read path for capturing a return/refund/withdrawal against an
 * order (#2036). Capture-only — no processing, no state-machine transition.
 *
 * THIN controller: reaches the orders context through `IOrderRefundService`
 * and `IOrderRecordService` — never a repository port directly (per
 * architecture-overview.md § Cross-context dependencies in core).
 *
 * Guards are GLOBAL (auth.module APP_GUARD = JwtAuthGuard then RolesGuard), so
 * we never declare a redundant `@UseGuards(JwtAuthGuard)`. The read carries no
 * `@Roles` but carries `@AnyRole()` (open to any authenticated role — since
 * #2079 that is declared, not inferred from an absent decorator); the write
 * carries its own
 * `@Roles('admin', 'operator')`, mirroring `ShipmentController`'s manual
 * operator-facing dispatch actions.
 *
 * A money-adjacent manual write is logged (who/what/when) — mirrors the
 * `ShipmentController` precedent for operator-facing dispatch actions.
 *
 * @module apps/api/src/orders/http
 */
import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Logger } from '@openlinker/shared/logging';
import type { RefundRecord } from '@openlinker/core/orders';
import {
  DuplicateRefundRecordException,
  RefundCurrencyMismatchException,
  IOrderRefundService,
  IOrderRecordService,
  ORDER_REFUND_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
} from '@openlinker/core/orders';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AnyRole } from '../../auth/decorators/any-role.decorator';
import { RecordRefundRequestDto } from './dto/record-refund-request.dto';
import { RefundRecordResponseDto } from './dto/refund-record-response.dto';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class RefundsController {
  private readonly logger = new Logger(RefundsController.name);

  constructor(
    @Inject(ORDER_REFUND_SERVICE_TOKEN)
    private readonly refundService: IOrderRefundService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService,
  ) {}

  @Roles('admin', 'operator')
  @Post(':internalOrderId/refunds')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a return/refund/withdrawal against an order' })
  @ApiResponse({ status: 201, type: RefundRecordResponseDto })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({
    status: 409,
    description: 'Duplicate idempotencyKey, or currency mismatch with a prior refund on this order',
  })
  async recordRefund(
    @Param('internalOrderId') internalOrderId: string,
    @Body() dto: RecordRefundRequestDto,
  ): Promise<RefundRecordResponseDto> {
    const orderRecord = await this.orderRecordService.getOrderRecord(internalOrderId);
    if (!orderRecord) {
      throw new NotFoundException(`Order not found: ${internalOrderId}`);
    }

    this.logger.log(
      `Recording refund for order ${internalOrderId}: ${dto.amount} ${dto.currency} (${dto.reason})`,
    );

    try {
      const refund = await this.refundService.recordRefund({
        internalOrderId,
        amount: dto.amount,
        currency: dto.currency,
        reason: dto.reason,
        note: dto.note ?? null,
        recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
        idempotencyKey: dto.idempotencyKey ?? null,
      });

      return this.toDto(refund);
    } catch (error) {
      if (error instanceof DuplicateRefundRecordException) {
        throw new ConflictException('A refund with this idempotencyKey already exists for this order');
      }
      if (error instanceof RefundCurrencyMismatchException) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  @AnyRole()
  @Get(':internalOrderId/refunds')
  @ApiOperation({
    summary: 'List refunds recorded against an order',
    description:
      'Does not verify the order exists — an unknown or never-refunded internalOrderId ' +
      'both return an empty array. Use the write endpoint (which does 404) to check existence.',
  })
  @ApiResponse({ status: 200, type: [RefundRecordResponseDto] })
  async listRefunds(
    @Param('internalOrderId') internalOrderId: string,
  ): Promise<RefundRecordResponseDto[]> {
    const refunds = await this.refundService.getRefundsForOrder(internalOrderId);
    return refunds.map((refund) => this.toDto(refund));
  }

  private toDto(refund: RefundRecord): RefundRecordResponseDto {
    const dto = new RefundRecordResponseDto();
    dto.id = refund.id;
    dto.internalOrderId = refund.internalOrderId;
    dto.amount = refund.amount;
    dto.currency = refund.currency;
    dto.reason = refund.reason;
    dto.note = refund.note;
    dto.recordedAt = refund.recordedAt;
    dto.createdAt = refund.createdAt;
    return dto;
  }
}
