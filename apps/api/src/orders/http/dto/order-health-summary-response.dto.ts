/**
 * Order Health Summary Response DTO
 *
 * Response shape for GET /orders/status-summary (#929). Carries the count of
 * order records per derived-health bucket for the current filter scope. The
 * four buckets partition the set, so `total` equals their sum — the list-page
 * status segments rely on this to render counts that add up.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class OrderHealthSummaryResponseDto {
  @ApiProperty({ description: 'Total order records in scope (sum of the four buckets)' })
  total!: number;

  @ApiProperty({ description: 'recordStatus = awaiting_mapping (item refs unresolved)' })
  awaitingMapping!: number;

  @ApiProperty({ description: 'ready AND at least one destination failed' })
  needsAttention!: number;

  @ApiProperty({ description: 'ready, no failed, at least one destination synced' })
  synced!: number;

  @ApiProperty({ description: 'ready, no failed, no synced (empty / pending / syncing)' })
  awaitingDispatch!: number;
}
