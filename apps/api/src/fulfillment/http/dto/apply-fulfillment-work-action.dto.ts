/**
 * Action request DTO (#2406)
 *
 * `expectedVersion` is REQUIRED. There is deliberately no unguarded action path:
 * an optional token is a token somebody forgets, and the failure it guards is
 * two operators shipping the same work twice.
 *
 * The per-action fields are optional HERE and required per action in the core
 * service — one action endpoint means one DTO, and the validity of `holdReason`
 * depends on which action was named in the path.
 *
 * @module apps/api/src/fulfillment/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { FulfillmentCancellationReasonValues } from '@openlinker/core/fulfillment-authority';
import { HoldReasonValues } from '@openlinker/core/order-lifecycle';

export class ApplyFulfillmentWorkActionDto {
  @ApiProperty({
    description:
      'The optimistic token read with the work. A stale token answers 409 carrying the ' +
      'refreshed supportedActions.',
  })
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @ApiPropertyOptional({ enum: HoldReasonValues, description: 'Required for the hold action' })
  @IsOptional()
  @IsIn(HoldReasonValues)
  holdReason?: (typeof HoldReasonValues)[number];

  @ApiPropertyOptional({
    enum: FulfillmentCancellationReasonValues,
    description: "Reason for force_cancel; defaults to 'operator_forced'",
  })
  @IsOptional()
  @IsIn(FulfillmentCancellationReasonValues)
  cancellationReason?: (typeof FulfillmentCancellationReasonValues)[number];

  @ApiPropertyOptional({ description: 'Required for the release_hold action' })
  @IsOptional()
  @IsString()
  holdId?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  releaseNote?: string;
}
