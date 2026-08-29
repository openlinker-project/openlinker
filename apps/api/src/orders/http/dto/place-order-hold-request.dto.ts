/**
 * Place Order Hold Request DTO (#2341)
 *
 * Request body for `POST /orders/:internalOrderId/holds`.
 * `internalOrderId` is a path param, not part of the body.
 *
 * `reason` is validated against the CLOSED `HoldReasonValues` union
 * (`@openlinker/core/order-lifecycle`) — an unrecognised reason must surface as
 * a 400 rather than silently becoming `operator`, which would attribute a
 * machine's hold to a human (`hold-reason.types.ts`).
 *
 * The actor is never taken from the body: it is stamped from `@CurrentUser()` at
 * the controller, so a caller cannot claim to be someone else.
 *
 * @module apps/api/src/orders/http/dto
 */
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HoldReason, HoldReasonValues } from '@openlinker/core/order-lifecycle';

export class PlaceOrderHoldRequestDto {
  @ApiProperty({
    enum: HoldReasonValues,
    description: 'Why this order is being held. Closed vocabulary.',
  })
  @IsIn(HoldReasonValues)
  reason!: HoldReason;

  @ApiPropertyOptional({
    example: 'Buyer asked us to wait until Friday.',
    description:
      'Operator free text. Never buyer data. Empty/whitespace normalises to null.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
