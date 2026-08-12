/**
 * Refund Record Response DTO
 *
 * Flat projection of `RefundRecord` returned by the refund write/read
 * endpoints (#2036).
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RefundRecordResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  internalOrderId!: string;

  @ApiProperty()
  amount!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  reason!: string;

  @ApiPropertyOptional({ nullable: true })
  note: string | null = null;

  @ApiProperty()
  recordedAt!: Date;

  @ApiProperty()
  createdAt!: Date;
}
