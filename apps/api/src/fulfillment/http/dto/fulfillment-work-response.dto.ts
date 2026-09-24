/**
 * Worklist response DTOs (#2406)
 *
 * An explicit allowlist all the way out. The core `FulfillmentWorkView` is
 * already a projection; restating it here is what keeps the HTTP surface from
 * silently widening when a field is added to either shape, and this response
 * reaches an operator's browser.
 *
 * ## `buyerNameMasked` is the only buyer PII here, and may not gain a sibling
 *
 * #3425 reversed ADR-062's buyer-PII exclusion for ONE value, on ONE
 * condition: it is masked to an initial plus surname, server-side, at
 * projection time, from a value the read already loads. The full name is
 * never resolved on this path, so there is no unmasked value present for a
 * later change to leak.
 *
 * The concrete risk this note exists for is a `buyerName` added "just for the
 * detail view". That would not be a widening of this field, it would be a new
 * reversal, and it needs the argument made again rather than inherited. The
 * three exclusions that did NOT move are address, email and phone.
 *
 * Note also what does not protect this: ADR-062's allowlist machinery guards
 * projections crossing to a PLUGIN (#2393's `RoutingInput`). This is an HTTP
 * response to a signed-in operator, so none of those guards apply to it and a
 * reader must not assume they do. `apps/api/src/auth/packer-exclusion.spec.ts`
 * is the authority for what these surfaces disclose.
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
  @ApiPropertyOptional({
    nullable: true,
    description:
      "The parent PRODUCT's name (#3426) — `ProductVariant` carries none of its own. null when " +
      'the variant is absent from the catalogue; never a placeholder that reads like a name, ' +
      'because productVariantId is still on the row and a fabricated label is not actionable.',
  })
  productName!: string | null;
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
  @ApiPropertyOptional({
    nullable: true,
    description:
      "The source's own order reference — what a marketplace calls the order and what an " +
      'operator says out loud (#3426). null when the order is absent from order_records (a work ' +
      'holds orderId by value with no FK, so it can outlive or precede its order record) or its ' +
      'snapshot names none. Deliberately NOT a fallback to orderId, which is on this row anyway.',
  })
  orderReference!: string | null;
  @ApiPropertyOptional({ nullable: true }) locationId!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description:
      "The location's operator-authored name (#2313, surfaced by #3426). null when locationId " +
      'is null (the master declines to locate its stock — ADR-058 decision 2) or the row is gone.',
  })
  locationName!: string | null;
  @ApiPropertyOptional({ nullable: true }) deliveryMethod!: string | null;
  @ApiPropertyOptional({ nullable: true }) assignedConnectionId!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description:
      "A supervisor's advisory pre-assignment to a specific packer (#3337, ADR-074) — " +
      'distinct from assignedConnectionId, the holder connection.',
  })
  assignedToUserId!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'When this parcel last became unassigned, ISO-8601 (#3424). Read it ' +
      'TOGETHER with assignedToUserId: null on an assigned row means there is ' +
      'no waiting to report, while null on an unassigned row means the row ' +
      'predates this field - an unknown age, never a zero one.',
  })
  unassignedSince!: string | null;
  @ApiProperty({
    description:
      'Whether a packer other than assignedToUserId may still work this parcel. true is the ' +
      'advisory default.',
  })
  selfServeEligible!: boolean;
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
  @ApiPropertyOptional({
    nullable: true,
    description:
      "The buyer's name, MASKED to a first initial plus surname (e.g. \"A. Kowalska\") — #3425, " +
      "a deliberate reversal of ADR-062's buyer-PII exclusion, conditional on the masking. " +
      'The masking happens SERVER-SIDE at projection time from a value this endpoint already ' +
      'loads: the full name is never resolved here, so it is not a display convention a caller ' +
      'may undo. This field may NOT gain an unmasked sibling — see the module docblock and ' +
      "ADR-062's scope amendment.",
  })
  buyerNameMasked!: string | null;
  @ApiPropertyOptional({ nullable: true, description: "The order's dispatch deadline (#3425)" })
  dispatchByAt!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: "The source's own delivery-method label (#3425); null when the source reports none",
  })
  carrierName!: string | null;
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
