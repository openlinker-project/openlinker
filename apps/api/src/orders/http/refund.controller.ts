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
 * `@Roles` (open to any authenticated role); the write carries its own
 * `@Roles('admin', 'operator')`, mirroring `ShipmentController`'s manual
 * operator-facing dispatch actions.
 *
 * @module apps/api/src/orders/http
 */
import {
  Body,
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
import type { RefundRecord } from '@openlinker/core/orders';
import {
  IOrderRefundService,
  IOrderRecordService,
  ORDER_REFUND_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
} from '@openlinker/core/orders';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RecordRefundRequestDto } from './dto/record-refund-request.dto';
import { RefundRecordResponseDto } from './dto/refund-record-response.dto';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class RefundsController {
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
  async recordRefund(
    @Param('internalOrderId') internalOrderId: string,
    @Body() dto: RecordRefundRequestDto,
  ): Promise<RefundRecordResponseDto> {
    const orderRecord = await this.orderRecordService.getOrderRecord(internalOrderId);
    if (!orderRecord) {
      throw new NotFoundException(`Order not found: ${internalOrderId}`);
    }

    const refund = await this.refundService.recordRefund({
      internalOrderId,
      amount: dto.amount,
      currency: dto.currency,
      reason: dto.reason,
      note: dto.note ?? null,
      recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
    });

    return this.toDto(refund);
  }

  @Get(':internalOrderId/refunds')
  @ApiOperation({ summary: 'List refunds recorded against an order' })
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
