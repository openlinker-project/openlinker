/**
 * Refund Record Response DTO
 *
 * Flat projection of `RefundRecord` returned by the refund write/read
 * endpoints (#2036).
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RefundReason, RefundReasonValues } from '@openlinker/core/orders';
import { RefundCeilingVerdictDto } from './refund-ceiling-verdict.dto';

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

  @ApiPropertyOptional({
    type: () => RefundCeilingVerdictDto,
    description:
      'The ceiling verdict this record was written under (#3289). `status: unknown` means the ceiling could not ' +
      'be checked and the refund proceeded unchecked; `reason` says why. Present on the write response only.',
  })
  refundCeiling?: RefundCeilingVerdictDto;
}
