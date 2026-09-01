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

  @ApiProperty({
    description:
      'Orders where the shop and the channel named DIFFERENT tax rates (#2254). Its OWN count, ' +
      'never part of salesDocumentBlocked: a conflict does not stop the invoice, so an order can ' +
      'be in conflict and perfectly healthy, and folding it in would print one number twice on ' +
      'the same screen.',
  })
  taxRateConflict!: number;

  @ApiProperty({
    nullable: true,
    description:
      'When the OLDEST still-held order was held (ISO 8601), or null when nothing is held ' +
      '(#2254). Lets the blocked chip carry an age inside its label rather than adding a third ' +
      'dotted badge to a row that already has two SLA badges.',
  })
  salesDocumentBlockedOldestAt!: string | null;

  @ApiProperty({
    description:
      'Orders whose sales document is issued ONLY on request — the trigger-model-manual gate ' +
      'reason (#2554). Its OWN count, never part of salesDocumentBlocked: manual is the default ' +
      'trigger model, so counting it as blocked would put a large red number on a healthy install.',
  })
  salesDocumentIssuedOnRequest!: number;
}
