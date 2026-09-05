/**
 * Worklist response DTOs (#2406)
 *
 * An explicit allowlist all the way out. The core `FulfillmentWorkView` is
 * already a projection; restating it here is what keeps the HTTP surface from
 * silently widening when a field is added to either shape, and this response
 * reaches an operator's browser.
 *
 * @module apps/api/src/fulfillment/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { FulfillmentCancellationReason } from '@openlinker/core/fulfillment-authority';
import { HoldReason } from '@openlinker/core/order-lifecycle';
import {
  FulfillmentRequestStatusValues,
  FulfillmentWorkActionValues,
  FulfillmentWorkConflictCodeValues,
  FulfillmentWorkStatusValues,
  type FulfillmentRequestStatus,
  type FulfillmentWorkAction,
  type FulfillmentWorkConflictCode,
  type FulfillmentWorkStatus,
} from '@openlinker/core/fulfillment';

export class FulfillmentWorkLineResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderLineId!: string;
  @ApiProperty() productVariantId!: string;
  @ApiProperty() totalQuantity!: number;
  @ApiProperty({
    description:
      'Display-only. NOT protected by the optimistic token — progress ingress moves counters ' +
      'without bumping the header version (#2400), so this may be behind reality.',
  })
  fulfilledQuantity!: number;
  @ApiProperty({ description: 'Display-only; see fulfilledQuantity.' })
  cancelledQuantity!: number;
}

export class FulfillmentHoldResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() reason!: HoldReason;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiProperty() placedAt!: Date;
}

export class FulfillmentWorkResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderId!: string;
  @ApiPropertyOptional({ nullable: true }) locationId!: string | null;
  @ApiPropertyOptional({ nullable: true }) deliveryMethod!: string | null;
  @ApiPropertyOptional({ nullable: true }) assignedConnectionId!: string | null;
  @ApiProperty({ enum: FulfillmentWorkStatusValues }) status!: FulfillmentWorkStatus;
  @ApiProperty({ enum: FulfillmentRequestStatusValues }) requestStatus!: FulfillmentRequestStatus;
  @ApiProperty() assignmentAttempt!: number;
  @ApiPropertyOptional({ nullable: true }) cancellationReason!: FulfillmentCancellationReason | null;
  @ApiPropertyOptional({ nullable: true }) externalWorkId!: string | null;
  @ApiPropertyOptional({ nullable: true }) acceptedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) cancelledAt!: Date | null;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'When an operator pushed this ahead of ordinary deadline order (#2416); null otherwise. ' +
      'Present so a surface can SHOW that a task was expedited rather than silently reordering ' +
      'itself under whoever is reading it.',
  })
  expeditedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiProperty({ type: [FulfillmentWorkLineResponseDto] })
  lines!: FulfillmentWorkLineResponseDto[];
  @ApiProperty({
    type: [FulfillmentHoldResponseDto],
    description: 'The AUTHORITY on heldness — nothing writes status = on_hold. Render from this.',
  })
  activeHolds!: FulfillmentHoldResponseDto[];
  @ApiProperty({
    enum: FulfillmentWorkActionValues,
    isArray: true,
    description:
      'What is legal next, derived server-side. Never recompute this client-side — that is the ' +
      'client-side state-machine drift the read model exists to remove.',
  })
  supportedActions!: FulfillmentWorkAction[];
  @ApiProperty({
    description: 'Optimistic token. Send it back with every action; a stale one answers 409.',
  })
  version!: number;
}

export class FulfillmentWorkPageResponseDto {
  @ApiProperty({ type: [FulfillmentWorkResponseDto] }) works!: FulfillmentWorkResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty({ description: 'The limit actually applied after clamping.' }) limit!: number;
  @ApiProperty() offset!: number;
}

/**
 * The stale-token 409 body — RETRYABLE.
 *
 * Carries the refreshed action set so a client can re-render its controls and
 * retry without a second GET, and a `code` so it never has to infer which of the
 * two 409s it received from which fields happen to be present.
 */
export class FulfillmentWorkConflictResponseDto {
  @ApiProperty({ enum: FulfillmentWorkConflictCodeValues, example: 'version_conflict' })
  code!: FulfillmentWorkConflictCode;
  @ApiProperty() message!: string;
  @ApiProperty() workId!: string;
  @ApiProperty() expectedVersion!: number;
  @ApiProperty({ description: 'Best-effort snapshot; the retry is guarded by the token anyway.' })
  currentVersion!: number;
  @ApiProperty({ enum: FulfillmentWorkActionValues, isArray: true })
  supportedActions!: FulfillmentWorkAction[];
}

/**
 * The not-legal 409 body — NOT retryable.
 *
 * The token was current; the state refused. Re-sending the identical request
 * fails identically, so a client surfaces this rather than retrying.
 */
export class FulfillmentWorkActionNotLegalResponseDto {
  @ApiProperty({ enum: FulfillmentWorkConflictCodeValues, example: 'action_not_legal' })
  code!: FulfillmentWorkConflictCode;
  @ApiProperty() message!: string;
  @ApiProperty() workId!: string;
  @ApiProperty({ enum: FulfillmentWorkActionValues }) action!: FulfillmentWorkAction;
  @ApiProperty({ enum: FulfillmentWorkActionValues, isArray: true })
  supportedActions!: FulfillmentWorkAction[];
}
