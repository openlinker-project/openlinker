/**
 * Order Health Summary Response DTO
 *
 * Response shape for GET /orders/status-summary (#929). Carries the count of
 * order records per derived-health bucket for the current filter scope. The
 * FIVE health buckets partition the set, so `total` equals their sum — the
 * list-page status segments rely on this to render counts that add up.
 *
 * `salesDocumentBlocked` (#2100) rides along on the same round-trip but is NOT
 * a member of that partition; see its own description.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class OrderHealthSummaryResponseDto {
  @ApiProperty({ description: 'Total order records in scope (sum of the five buckets)' })
  total!: number;

  @ApiProperty({
    description:
      'recordStatus = source_deleted — at least one item ref is permanently unresolvable, the mapped variant was deleted at its master (#1689)',
  })
  sourceDeleted!: number;

  @ApiProperty({ description: 'recordStatus = awaiting_mapping (item refs unresolved, self-healing)' })
  awaitingMapping!: number;

  @ApiProperty({ description: 'ready AND at least one destination failed' })
  needsAttention!: number;

  @ApiProperty({ description: 'ready, no failed, at least one destination synced' })
  synced!: number;

  @ApiProperty({ description: 'ready, no failed, no synced (empty / pending / syncing)' })
  awaitingDispatch!: number;

  @ApiProperty({
    description:
      'Orders OpenLinker declined to invoice, carrying a persisted sales-document block ' +
      'reason (#2100, ADR-041 decision 11). ORTHOGONAL to the five health buckets and NOT ' +
      'part of the partition — a blocked order is also counted in exactly one of them (most ' +
      'often "synced"), so this number must never be added to their sum.',
  })
  salesDocumentBlocked!: number;
}
