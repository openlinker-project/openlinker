/**
 * Tax Re-run-Backfill DTOs
 *
 * Request/response for `POST /analytics/coverage/tax/rerun-backfill` (#2469) —
 * the Data Coverage panel's category-C action, "resolve these orders' tax rates
 * from the catalogue now instead of waiting for the next scheduled sweep".
 *
 * The order ids come from the client because the operator selected them in the
 * `detail-postrollout` drill-down; the endpoint does not re-derive the category
 * server-side. That is deliberate and safe rather than lax: the backfill only
 * ever writes a rate the CURRENT catalogue actually resolves, and only onto a
 * line that has none — so an id outside category C is a no-op, not a
 * mis-write. The bound below exists to keep one request's work bounded, not to
 * police the selection.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

/**
 * Upper bound on one request's order count. Each order costs one line read plus
 * one catalogue read per rate-less line, all synchronous — this is the largest
 * batch that stays comfortably inside a normal request budget, and it matches
 * the drill-down list's realistic page size rather than a round number.
 */
export const MAX_RERUN_BACKFILL_ORDERS = 200;

export class TaxRerunBackfillRequestDto {
  @ApiProperty({
    description: `Internal order ids to re-resolve tax rates for (max ${MAX_RERUN_BACKFILL_ORDERS}).`,
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RERUN_BACKFILL_ORDERS)
  @IsString({ each: true })
  internalOrderIds!: string[];
}

export class TaxRerunBackfillResponseDto {
  @ApiProperty({ description: 'Rate-less lines examined across every requested order.' })
  scanned!: number;

  @ApiProperty({
    description:
      'Of those, lines the current catalogue resolved a rate for and that were written. A line the catalogue still cannot answer for is left untouched for a later run.',
  })
  updated!: number;
}
