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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The three "Needs a look" group totals (#4025). Each is a count of DISTINCT
 * orders matching ANY filter in its group, so it is NOT the sum of the
 * per-filter counts beside it.
 */
export class OrderAttentionSummaryResponseDto {
  @ApiProperty({
    description:
      'Orders that are SLA overdue, SLA at risk, or due to ship within 24 hours (union, each order once)',
  })
  lateToShip!: number;

  @ApiProperty({
    description:
      'Orders with a blocked sales document, an OpenLinker inert state, a routing block, a wait in ' +
      'OpenLinker or a tax rate conflict (union, each order once)',
  })
  stuck!: number;

  @ApiPropertyOptional({
    description:
      'Orders on the pack bench, with a buyer note, or with an open return (union, each order once). ' +
      'Absent when the open returns could not be read: the count is unknown, never 0.',
  })
  toHandle?: number;
}

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
      'Orders whose fulfilment routing decision narrowed the destination fan-out in an ' +
      'attention-worthy way (#2703/#2704). ORTHOGONAL to the five health buckets and NOT part of ' +
      'the partition — such an order is also counted in exactly one of them — so this number must ' +
      'never be added to their sum. Counts the attention-worthy subset only: a deliberate ' +
      '"routed-to-no-destination" decision and the "no-destination-configured" fact (#3959) are ' +
      'badged neutrally per order and never aggregated.',
  })
  destinationRoutingBlocked!: number;

  @ApiProperty({
    description:
      'Orders OpenLinker holds as waiting (#3482): out of stock, no shipping address or a ' +
      'routing error (#3485). ORTHOGONAL to the five health buckets and NOT part of the ' +
      'partition, so this number must never be added to their sum.',
  })
  waitingInOpenLinker!: number;

  @ApiProperty({
    nullable: true,
    description:
      'When the OLDEST waiting order started waiting (ISO 8601), or null when none waits ' +
      '(#3482). Rendered as the chip\'s age, the salesDocumentBlockedOldestAt shape.',
  })
  waitingInOpenLinkerOldestAt!: string | null;

  @ApiProperty({
    description:
      'Orders with a live pack-bench work whose box is not shut yet - To pack or Packing ' +
      '(#3482). ORTHOGONAL to the health partition; a list filter only.',
  })
  onPackBench!: number;

  @ApiProperty({
    description:
      'Orders where the shop and the channel named DIFFERENT tax rates (#2254). Its OWN count, ' +
      'never part of salesDocumentBlocked: a conflict does not stop the invoice, so an order can ' +
      'be in conflict and perfectly healthy, and folding it in would print one number twice on ' +
      'the same screen.',
  })
  taxRateConflict!: number;

  @ApiProperty({
    description:
      'Orders carrying at least one COUNTED OMS inert state (#2352/#2353) - OpenLinker stopped ' +
      'deciding something. A THIRD orthogonal axis, never inside salesDocumentBlocked or ' +
      'taxRateConflict and never part of the health partition: an order can be blocked, in ' +
      'conflict and short on stock at once. NOT the `needs_attention` health bucket, which ' +
      'means a sync failure. The ORDER half only - return-scoped states are counted on the ' +
      'returns side. A reason this build does not recognise is never counted.',
  })
  omsAttention!: number;

  @ApiProperty({
    description:
      'Orders where a shop still shows the order unpaid and OpenLinker gave up sending the payment ' +
      '(#3963). Its own axis, never inside the health partition.',
  })
  paymentNotSent!: number;

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

  @ApiPropertyOptional({
    description:
      'Orders with an open return (#4025) - the same id list the ?openReturn=true filter uses. ' +
      'Orthogonal to the health partition. Absent when the open returns could not be read: ' +
      'the count is unknown, never 0.',
  })
  openReturn?: number;

  @ApiProperty({
    description:
      'Orders with a buyer note an operator can act on (#4025) - the ?hasBuyerNote=true predicate. ' +
      'Orthogonal to the health partition.',
  })
  hasBuyerNote!: number;

  @ApiProperty({
    description:
      'Orders with a ship-by deadline within the next 24 hours or already past (#4025) - the ' +
      '?dueBefore=<now + 24h> predicate. Orthogonal to the health partition.',
  })
  dueWithin24h!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    description:
      'Order count per source connection id (#4025), counted with every scope EXCEPT ' +
      'sourceConnectionId itself. A connection with no orders in scope is absent, never 0.',
  })
  bySource!: Record<string, number>;

  @ApiProperty({
    type: OrderAttentionSummaryResponseDto,
    description: 'The three "Needs a look" group totals (#4025)',
  })
  attention!: OrderAttentionSummaryResponseDto;
}
