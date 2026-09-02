/**
 * Order Lifecycle Phase Summary Response DTO
 *
 * Response shape for GET /orders/lifecycle-summary (#2309, ADR-059). Carries
 * the count of order records per derived lifecycle phase for the given
 * source/customer/date scope.
 *
 * Every bucket tests the same single SQL `CASE` expression the `?phase=` filter
 * tests, so `total` equals their sum by construction and each count always
 * matches the rows that filter returns. Mirrors `OrderLifecyclePhaseSummary` in
 * `@openlinker/core/orders`.
 *
 * A SECOND ORTHOGONAL PARTITION beside GET /orders/status-summary, never a
 * sixth health bucket — the two are read together, not merged.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class OrderLifecyclePhaseSummaryResponseDto {
  @ApiProperty({ description: 'Total order records in scope (sum of the nine buckets)' })
  total!: number;

  @ApiProperty({ description: 'Cancelled orders — outranks every phase below, incl. a shipment' })
  cancelled!: number;

  @ApiProperty({
    description:
      'Vendor holds lifecycle authority and declared nothing OL can classify. Structurally 0 ' +
      'until posture-B adapters land (Wave 4) — a correct report about a fact OL does not yet record.',
  })
  vendorAuthoritative!: number;

  @ApiProperty({ description: 'Delivered — a terminal observed fulfilment outcome' })
  delivered!: number;

  @ApiProperty({ description: 'Dispatched and not yet delivered' })
  inTransit!: number;

  @ApiProperty({ description: 'Fulfilment was attempted and failed' })
  fulfillmentFailed!: number;

  @ApiProperty({
    description:
      'An active order-grain hold. Structurally 0 until the hold column lands (Wave 2).',
  })
  held!: number;

  @ApiProperty({
    description:
      'An OL-authored amendment is in flight. Structurally 0 until order_changes widens (Wave 2).',
  })
  amending!: number;

  @ApiProperty({ description: "OL's own ingest gap — unmapped variant or source-deleted product" })
  blocked!: number;

  @ApiProperty({ description: 'Residual — nothing above applies' })
  ready!: number;
}
