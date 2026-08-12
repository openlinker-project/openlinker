/**
 * Record Refund Request DTO
 *
 * Request body for `POST /orders/:internalOrderId/refunds` (#2036).
 * `internalOrderId` is a path param, not part of the body.
 *
 * @module apps/api/src/orders/http/dto
 */
import { IsIn, IsISO8601, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RefundReason, RefundReasonValues } from '@openlinker/core/orders';

export class RecordRefundRequestDto {
  /** Decimal string, e.g. "49.99". 0 is valid (a goodwill return, no money moved). */
  @ApiProperty({ example: '49.99', description: 'Decimal string amount, up to 2 decimal places' })
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'amount must be a non-negative decimal string with up to 2 decimal places',
  })
  amount!: string;

  @ApiProperty({ example: 'PLN', description: 'ISO 4217 3-letter currency code' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({ enum: RefundReasonValues })
  @IsIn(RefundReasonValues)
  reason!: RefundReason;

  @ApiPropertyOptional({ example: 'Buyer exercised 14-day right of withdrawal' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({ description: 'Defaults to now when omitted' })
  @IsOptional()
  @IsISO8601()
  recordedAt?: string;
}
