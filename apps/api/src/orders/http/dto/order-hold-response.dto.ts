/**
 * Order Hold Response DTOs (#2341)
 *
 * The operator-facing projection of an `order_holds` row, plus the two route
 * responses.
 *
 * ## Where these appear, and where they deliberately do not
 *
 * `activeHold` + `holdHistory[]` are attached ONLY by the order-DETAIL read
 * (`GET /orders/:internalOrderId`), never by the shared `toDto` that runs per
 * row on the paged list — `listHolds` is one query per order, so on the list
 * that is an N+1 behind a paged table. They are consequently declared optional
 * on `OrderRecordResponseDto` (the `deliveryResolution` / `deliveryRider`
 * precedent), which means the FE must read them with `.nullish()`, never
 * `.optional()` (#939).
 *
 * The list is not left blind: it carries the single scalar
 * `OrderRecordResponseDto.activeHoldReason`, which is free because the column is
 * already loaded. **That column is #2340's display cache with an hourly repair
 * window — a badge may render it; no GATE may read it.** Whether an order is
 * held is decided through `IOrderHoldService.getOpenHold` against `order_holds`,
 * which is the epic's L4 exit criterion, not a preference.
 *
 * Every column of `order_holds` is projected here: all of it is operator-facing
 * audit data and none of it is a secret (`note` / `releaseNote` are operator
 * free text — never buyer data, per #2338's types).
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { HoldReasonValues, type HoldReason } from '@openlinker/core/order-lifecycle';
import {
  ProvisioningResumeSkipReasonValues,
  type ProvisioningResumeSkipReason,
} from '@openlinker/core/orders';

export class OrderHoldDto {
  @ApiProperty({ description: 'Plain uuid — a hold is not an `ol_*` internal id.' })
  id!: string;

  @ApiProperty()
  internalOrderId!: string;

  @ApiProperty({ enum: HoldReasonValues })
  reason!: HoldReason;

  @ApiProperty({ nullable: true, description: 'Operator free text. Never buyer data.' })
  note!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Exactly one of placedByUserId / placedByService is set on every row.',
  })
  placedByUserId!: string | null;

  @ApiProperty({ nullable: true })
  placedByService!: string | null;

  @ApiProperty({ description: 'ISO 8601. Stamped from OL’s clock — a hold is an OL-internal act.' })
  placedAt!: string;

  @ApiProperty({ nullable: true, description: 'ISO 8601. Null while the hold is open.' })
  releasedAt!: string | null;

  @ApiProperty({ nullable: true })
  releasedByUserId!: string | null;

  @ApiProperty({ nullable: true, description: 'Operator free text. Never buyer data.' })
  releaseNote!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

/**
 * What OL did about the provisioning run the released hold had been suppressing.
 *
 * Reported rather than assumed: `marketplace.order.sync` has no cron backstop
 * for one specific order, so a lost enqueue leaves that order un-provisioned
 * until something unrelated re-polls it. A 2xx that silently claimed
 * "provisioning resumed" would assert a fact OL had not witnessed.
 *
 * `reason` on the `failed` arm is a stable CODE, never the caught message — an
 * enqueue failure surfaces from Redis / Postgres / TypeORM and those messages
 * routinely carry a host, a port, sometimes a credential fragment.
 */
export class ProvisioningResumeDto {
  @ApiProperty({ enum: ['enqueued', 'skipped', 'failed'] })
  status!: 'enqueued' | 'skipped' | 'failed';

  @ApiProperty({ nullable: true, description: 'Set only when status is `enqueued`.' })
  jobId!: string | null;

  @ApiProperty({
    nullable: true,
    enum: [...ProvisioningResumeSkipReasonValues, 'enqueue-failed'],
    description:
      'Why nothing was enqueued. A `skipped` order is healthy (it has no source-side ' +
      'job to run); a `failed` one needs the destination Retry action.',
  })
  reason!: ProvisioningResumeSkipReason | 'enqueue-failed' | null;
}

export class PlaceOrderHoldResponseDto {
  @ApiProperty({ type: OrderHoldDto })
  hold!: OrderHoldDto;

  /**
   * A dispatch of this order was in flight when the hold landed.
   *
   * The hold IS placed either way — this reports an overlap it could not
   * prevent. A carrier call already under way cannot be recalled, so a label
   * may exist for an order that now reads held; the operator needs to know
   * rather than discover it from a tracking number. `false` also covers
   * "could not tell".
   */
  @ApiProperty({
    description:
      'A dispatch of this order was in flight when the hold was placed, so a label may ' +
      'already have been minted. The hold is placed regardless.',
    example: false,
  })
  dispatchInFlight!: boolean;
}

export class ReleaseOrderHoldResponseDto {
  @ApiProperty({ type: OrderHoldDto })
  hold!: OrderHoldDto;

  @ApiProperty({ type: ProvisioningResumeDto })
  provisioningResume!: ProvisioningResumeDto;
}
