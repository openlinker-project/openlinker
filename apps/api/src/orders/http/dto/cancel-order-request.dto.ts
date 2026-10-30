/**
 * Cancel Order Request DTO (#3540)
 *
 * Body of `POST /orders/:internalOrderId/cancel`. The actor is never taken from
 * the body: it is stamped from `@CurrentUser()` at the controller.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { OrderCancelReasonValues, type OrderCancelReason } from '@openlinker/core/orders';

export class CancelOrderRequestDto {
  @ApiProperty({
    enum: OrderCancelReasonValues,
    description: 'Why the order is being cancelled. Closed vocabulary; only this code is sent to the sales channel.',
  })
  @IsIn(OrderCancelReasonValues)
  reason!: OrderCancelReason;

  @ApiPropertyOptional({
    example: 'Buyer called to say they ordered the wrong size.',
    description:
      'Operator free text, kept on the audit record and never sent to a sales channel. ' +
      'Required when reason is `other`.',
  })
  @ValidateIf((dto: CancelOrderRequestDto) => dto.reason === 'other' || dto.note !== undefined)
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({
    description:
      'Set to true to cancel an order whose fulfilment work a holder already accepted or started. ' +
      'Without it the request is refused with ORDER_WORK_ACCEPTED_NEEDS_ACK.',
  })
  @IsOptional()
  @IsBoolean()
  acknowledgeAcceptedWork?: boolean;
}
