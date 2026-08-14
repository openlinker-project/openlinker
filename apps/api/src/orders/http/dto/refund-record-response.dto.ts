/**
 * Refund Record Response DTO
 *
 * Flat projection of `RefundRecord` returned by the refund write/read
 * endpoints (#2036).
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { RefundReason, RefundReasonValues } from '@openlinker/core/orders';

export class RefundRecordResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  internalOrderId!: string;

  @ApiProperty()
  amount!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ enum: RefundReasonValues })
  reason!: RefundReason;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty()
  recordedAt!: Date;

  @ApiProperty()
  createdAt!: Date;
}
