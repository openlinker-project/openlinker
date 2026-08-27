/**
 * Return Response DTOs (#2334)
 *
 * The operator-facing projection of the return aggregate, consumed by the
 * returns list (#2335) and the return detail (#2336).
 *
 * **Every field here is an explicit allowlist entry.** `rawPayload` is
 * deliberately absent from all four shapes and must stay absent: it is the
 * source payload as received, it demonstrably carries buyer PII (`buyerEmail`
 * is named in `ReturnsService.buildRawPayload`'s docblock as a known gap with
 * no `OL_STORE_PII` parity), and returning it wholesale would make this
 * endpoint the leak. A spec asserts the exact key set so a column added to the
 * entity later cannot silently start shipping.
 *
 * `rawStatus` is the opposite case and is included on purpose: it is the
 * SOURCE's own word, stored verbatim and never interpreted, and the UI renders
 * it attributed as the source's words rather than as an OpenLinker
 * classification. It is `null` when the source reported nothing — never an
 * empty string, never a substituted default, because "the source said nothing"
 * and "the source said something" are different facts an operator acts on
 * differently.
 *
 * @module apps/api/src/returns/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  ReturnBucketValues,
  ReturnCustodyStateValues,
  ReturnDeclineUnsupportedReasonValues,
  ReturnDispositionValues,
  ReturnMoneyStateValues,
  ReturnOriginValues,
  ReturnRestockTargetStatusValues,
  ReturnRestockBlockReasonValues,
  ReturnRestockStateValues,
  type ReturnBucket,
  type ReturnCustodyState,
  type ReturnDeclineUnsupportedReason,
  type ReturnDisposition,
  type ReturnMoneyState,
  type ReturnOrigin,
  type ReturnRestockTargetStatus,
  type ReturnRestockBlockReason,
  type ReturnRestockState,
} from '@openlinker/core/returns';
import type { ReturnSegment, ReturnStage } from '@openlinker/core/returns';
import { RefundReasonValues, type RefundReason } from '@openlinker/core/orders/types';

export class ReturnLineResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Position within the aggregate; lines are ordered by it.' })
  lineIndex!: number;

  @ApiProperty({ nullable: true, description: "The source's own line id, when it has one." })
  externalLineId!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'The order line this return line was matched to, or null when it could not be matched. Null is a real state, not missing data — OpenLinker has no order-lines table to point at yet, so a consumer renders it as "could not be matched to a line" rather than as a blank.',
  })
  resolvedOrderLineId!: string | null;

  @ApiProperty({ nullable: true })
  offerId!: string | null;

  @ApiProperty({ nullable: true })
  sku!: string | null;

  @ApiProperty({ nullable: true })
  name!: string | null;

  @ApiProperty({
    enum: RefundReasonValues,
    description:
      "The source's open-world reason narrowed onto OpenLinker's vocabulary; an unrecognised value lands on 'other' rather than being dropped.",
  })
  reason!: RefundReason;

  @ApiProperty({ description: 'How much the source says is coming back.' })
  quantityAdvised!: number;

  @ApiProperty({ description: 'How much has actually arrived.' })
  quantityReceived!: number;

  @ApiProperty()
  quantityRestocked!: number;

  @ApiProperty()
  quantityScrapped!: number;

  @ApiProperty({
    enum: ReturnCustodyStateValues,
    description:
      'Wave-1c ships this at its default and drives it nowhere — a consumer renders it as "not tracked yet" rather than hiding it, so Wave 2 lights it up without a layout change.',
  })
  custodyState!: ReturnCustodyState;

  @ApiProperty({
    enum: ReturnMoneyStateValues,
    description: 'Declared but undriven in Wave 1c — see custodyState.',
  })
  moneyState!: ReturnMoneyState;

  @ApiProperty({
    enum: ReturnDispositionValues,
    nullable: true,
    description: 'Declared but undriven in Wave 1c — see custodyState.',
  })
  disposition!: ReturnDisposition | null;

  @ApiProperty({ nullable: true, description: 'ISO 8601.' })
  receivedAt!: string | null;

  @ApiProperty({ nullable: true, description: 'ISO 8601.' })
  disposedAt!: string | null;

  @ApiProperty({ nullable: true })
  note!: string | null;
}

/**
 * The per-return counter rollup the derived stage reads (#2377).
 *
 * Aggregated in SQL over the return's lines — the list projection carries no
 * lines, and hydrating every line of every row to compute six integers is not
 * what a header-shaped read is for.
 *
 * The frontend derives the stage from these with `deriveReturnStage`, the SAME
 * rule the backend's `RETURN_STAGE_PREDICATES` runs in SQL for the counts and
 * the filter. Two implementations of one rule, pinned by
 * `scripts/check-return-stage-mirror.mjs`.
 */
export class ReturnCountersDto {
  @ApiProperty({ description: "The return's line count." })
  lineCount!: number;

  @ApiProperty({
    description:
      'Lines written off as never arriving. `not_returned` is "every line", which no combination of quantity sums can express — hence the two line counts.',
  })
  notReturnedLineCount!: number;

  @ApiProperty({ description: 'Units the source announced, across every line.' })
  quantityAdvised!: number;

  @ApiProperty({
    description:
      'Advised units sitting on lines written off as never arriving. Subtracted from `quantityAdvised` to give the units STILL EXPECTED — without which a return with one line disposed and one written off reads as "partially received" forever.',
  })
  notReturnedQuantityAdvised!: number;

  @ApiProperty() quantityReceived!: number;
  @ApiProperty() quantityRestocked!: number;
  @ApiProperty() quantityScrapped!: number;
}

/**
 * How many returns sit in each derived operator stage (#2377).
 *
 * **Scoped with `stage` REMOVED from the caller's filters** (every other
 * dimension applied), for the reason `ReturnBucketCountsDto` gives about
 * `bucket`: the count for the dimension you are not looking at must stay
 * truthful, or every chip reports the count of the stage already selected.
 */
/**
 * The return header, as a list row.
 *
 * Carries no `lines`, because the list read hydrates none — a DTO promising an
 * array the query never fills would be a lie a consumer renders as "this return
 * has no lines".
 */
export class ReturnListItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    description:
      'The connection this return came from. Source attribution is this id and nothing more — a consumer resolves the display name and platform from the connections list it already holds, exactly as the orders list does.',
  })
  sourceConnectionId!: string;

  @ApiProperty({ nullable: true, description: "The source's own return id, when it mints one." })
  externalReturnId!: string | null;

  @ApiProperty({
    type: ReturnCountersDto,
    description:
      'The counter rollup the derived operator stage is computed from. Always present on THIS read — a return with no lines reports zeroes, which is a fact about the return rather than about the query.',
  })
  counters!: ReturnCountersDto;

  @ApiProperty({
    nullable: true,
    description:
      'Does this return hold a restock the master refused that nobody has attested (#2381)? ' +
      'A SIBLING of `counters`, never a member — the derived stage computes from counters alone. ' +
      '`null` means NOT REPORTED, never `false`: `false` asserts the operator\'s stock is fine, ' +
      'which is a claim OpenLinker cannot make about a read that did not ask.',
  })
  restockBlocked!: boolean | null;

  @ApiProperty({
    nullable: true,
    description: 'The order this return belongs to. Null exactly when bucket is "orphan".',
  })
  internalOrderId!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      "The source's own order reference, verbatim — the key the re-attribution reconcile resolves an orphan by.",
  })
  externalOrderId!: string | null;

  @ApiProperty({ enum: ReturnOriginValues })
  origin!: ReturnOrigin;

  @ApiProperty({
    enum: ReturnBucketValues,
    description:
      'Derived from `internalOrderId IS NULL` — the single definition of orphan. An orphan persists, is counted, and BLOCKS every downstream trigger (restock, refund, invoice correction, decline).',
  })
  bucket!: ReturnBucket;

  @ApiProperty({
    nullable: true,
    description:
      "The SOURCE's own status word, verbatim and never interpreted. Render it attributed to the source, never as an OpenLinker classification. Null means the source reported no status.",
  })
  rawStatus!: string | null;

  @ApiProperty({ nullable: true, description: 'ISO 8601.' })
  openedAt!: string | null;

  @ApiProperty({ nullable: true, description: 'ISO 8601.' })
  authorizedAt!: string | null;

  @ApiProperty({
    nullable: true,
    description: "ISO 8601. Stamped only from the SOURCE's own reported instant.",
  })
  declinedAt!: string | null;

  @ApiProperty({ nullable: true, description: 'ISO 8601.' })
  closedAt!: string | null;

  @ApiProperty({ description: 'ISO 8601.' })
  createdAt!: string;

  @ApiProperty({ description: 'ISO 8601.' })
  updatedAt!: string;
}

export class ReturnDeclineAvailabilityDto {
  @ApiProperty({
    description:
      'Whether the decline action may be offered. True is a DECLARATION, not a promise — the connection may still fail to resolve at call time, and the 400 from POST /returns/:id/decline remains the authority. When adapter metadata cannot be read at all this reports true, so an infrastructure hiccup never renders a permanently disabled button asserting the source has no such write.',
  })
  supported!: boolean;

  @ApiProperty({
    enum: ReturnDeclineUnsupportedReasonValues,
    nullable: true,
    description:
      'Why not, when supported is false. Does NOT include the orphan case — that is `bucket`, and a second spelling of it here would be a second definition of orphan.',
  })
  reason!: ReturnDeclineUnsupportedReason | null;
}

/**
 * Where a restock on this deployment WOULD land, resolved before anything is
 * disposed of (spec § 5.3: *"Stock will be added in {connection name}"*).
 *
 * Answered by the SAME resolver the dispose write uses, so the name shown and
 * the book written cannot disagree. It is on the read for that reason: the
 * resolver's candidate ordering is not reproducible in a browser, so a
 * client-side pick over `enabledCapabilities` could confidently name a
 * connection the write never touches — and a UI asserting a fact the backend
 * never stated costs the operator a manual reconciliation.
 *
 * `ambiguous-inventory-master` means the restock will be BLOCKED, not routed to
 * a first candidate: OpenLinker refuses to guess which book to write to.
 */
export class ReturnRestockTargetDto {
  @ApiProperty({
    enum: ReturnRestockTargetStatusValues,
    description:
      'The three non-resolved values are the same vocabulary a blocked restock records in ' +
      '`restockBlockedReason`, deliberately — a disclosure naming its states differently from the ' +
      'block it predicts would be a second, drifting answer to one question.',
  })
  status!: ReturnRestockTargetStatus;

  @ApiProperty({ nullable: true, description: 'Set only when `status` is `resolved`.' })
  connectionId!: string | null;

  @ApiProperty({ nullable: true, description: 'Set only when `status` is `resolved`.' })
  connectionName!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'How many connections claim the capability. Set only on `ambiguous-inventory-master`.',
  })
  candidateCount!: number | null;
}

/**
 * A refused restock nobody has attested yet (#2381, spec § 5.4).
 *
 * Every field the remediation copy interpolates travels with it — the copy names
 * the quantity, the sku and the system that refused, and a UI that had to fetch
 * those separately would render the alarm a beat late.
 */
export class ReturnRestockBlockDto {
  @ApiProperty({ description: 'The act to attest to.' }) eventId!: string;

  @ApiProperty({
    description:
      'The line these units belong to. NOT derivable from `sku` — two lines of one return can ' +
      'share one, and keying a per-line notice by sku would render one line\'s block under another\'s.',
  })
  returnLineId!: string;

  @ApiProperty() quantity!: number;
  @ApiProperty({ nullable: true }) sku!: string | null;
  @ApiProperty({ enum: ReturnRestockBlockReasonValues }) reason!: ReturnRestockBlockReason;

  @ApiProperty({ nullable: true, description: "The adapter's own sentence." })
  detail!: string | null;

  @ApiProperty({ nullable: true }) connectionId!: string | null;
  @ApiProperty({ nullable: true }) connectionName!: string | null;

  @ApiProperty({ enum: ReturnRestockStateValues })
  state!: ReturnRestockState;
}

/**
 * A recorded operator attestation — the TERMINAL STATE of the remediation loop.
 *
 * Disjoint from {@link ReturnRestockBlockDto} by construction: attesting flips
 * the act out of the blocked set, so a surface needs both reads — one to raise
 * the alarm and one to show it was answered. Without this the only observable
 * result of *"I handled this myself"* is that the alarm disappears, and the next
 * reader sees a line that was never blocked.
 */
export class ReturnRestockAttestationDto {
  @ApiProperty() eventId!: string;
  @ApiProperty() returnLineId!: string;
  @ApiProperty() quantity!: number;

  @ApiProperty({
    nullable: true,
    description:
      'Who attested, as an ID. OpenLinker resolves no display name for it, so a surface renders ' +
      '"by you" when it matches the session user and "by another operator" otherwise — never a ' +
      'raw id, and never a name it cannot verify.',
  })
  actorUserId!: string | null;

  @ApiProperty({ description: 'ISO-8601.' }) occurredAt!: string;
  @ApiProperty({ nullable: true }) note!: string | null;
}

/** The hydrated aggregate: the header above, plus its lines and the decline fact. */
export class ReturnResponseDto extends ReturnListItemResponseDto {
  @ApiProperty({ type: [ReturnLineResponseDto], description: 'Ordered by lineIndex.' })
  lines!: ReturnLineResponseDto[];

  @ApiProperty({ type: ReturnDeclineAvailabilityDto })
  declineAvailability!: ReturnDeclineAvailabilityDto;

  @ApiProperty({ type: ReturnRestockTargetDto })
  restockTarget!: ReturnRestockTargetDto;

  @ApiProperty({
    type: [ReturnRestockBlockDto],
    description: 'Refused restocks nobody has attested yet. Empty means none outstanding.',
  })
  restockBlocks!: ReturnRestockBlockDto[];

  @ApiProperty({
    type: [ReturnRestockAttestationDto],
    description: 'Attestations already recorded. Disjoint from `restockBlocks`.',
  })
  restockAttestations!: ReturnRestockAttestationDto[];
}

export class ReturnBucketCountsDto {
  @ApiProperty({
    description:
      'Returns in the filter scope WITH `bucket` removed. Equals orphan + attributed by construction.',
  })
  total!: number;

  @ApiProperty({ description: 'Of those, the ones OpenLinker could not attribute to an order.' })
  orphan!: number;

  @ApiProperty({ description: 'The remainder. Derived, never separately counted.' })
  attributed!: number;
}

/**
 * How many returns sit in each operator-facing segment (#2378, spec § 4.1).
 *
 * **`total` is NOT the sum of `bySegment`.** Segments OVERLAP by design — a
 * return can be `needs_disposition` and `money_pending` and `orphans` at once,
 * and `all_open` deliberately overlaps almost everything. `total` is the row
 * count of the segment-less scope, which is what the strip's `All returns` card
 * renders. The sibling `ReturnStageCountsDto` below IS a partition and does sum;
 * do not copy its assertion here.
 *
 * Scoped with `segment` REMOVED from the caller's filters (every other dimension
 * applied), or every card would report the count of the segment already selected.
 */
export class ReturnSegmentCountsDto {
  @ApiProperty({ description: 'Rows in the segment-less scope. NOT the sum of `bySegment`.' })
  total!: number;

  @ApiProperty({
    description: 'One count per segment. Segments overlap, so these do not sum to `total`.',
    additionalProperties: { type: 'number' },
  })
  bySegment!: Record<ReturnSegment, number>;
}

export class ReturnStageCountsDto {
  @ApiProperty({ description: 'Rows in the stage-less scope. Equal to the sum of `byStage`.' })
  total!: number;

  @ApiProperty({
    description: 'One count per derived stage. The six are exhaustive, so they sum to `total`.',
    additionalProperties: { type: 'number' },
  })
  byStage!: Record<ReturnStage, number>;
}

export class PaginatedReturnsResponseDto {
  @ApiProperty({ type: [ReturnListItemResponseDto] })
  items!: ReturnListItemResponseDto[];

  @ApiProperty({
    description:
      "Rows matching THIS request's filters, `bucket` INCLUDED — the number this page paginates against. Distinct from `counts.total`, which is deliberately bucket-less; see `counts`. Derived from `counts`, not queried separately, so the two can never disagree with each other — though both are read in a separate statement from `items`, so under a concurrent ingestion they may describe a marginally newer set than the rows on this page.",
  })
  total!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;

  @ApiProperty({
    type: ReturnSegmentCountsDto,
    description:
      "The worklist-strip partition — scoped with `segment` REMOVED from this request's filters. Segments overlap; these do not sum to `total`.",
  })
  segmentCounts!: ReturnSegmentCountsDto;

  @ApiProperty({
    type: ReturnStageCountsDto,
    description:
      'The derived-stage partition, scoped with `stage` REMOVED from this request\'s filters so the chip for the stage you are not looking at stays truthful.',
  })
  stageCounts!: ReturnStageCountsDto;

  @ApiProperty({
    type: ReturnBucketCountsDto,
    description:
      'The attribution partition over the same filters with `bucket` REMOVED — what the filter chips render. Bucket-less on purpose: counted under the caller\'s own bucket, the other chip would show either the number already on screen or a zero, and a chip row whose numbers describe different scopes is worse than none.',
  })
  counts!: ReturnBucketCountsDto;
}

export class ReturnIngestionAvailabilityResponseDto {
  @ApiProperty({
    description:
      'Whether ANY connection\'s adapter declares returns ingestion. Lets an empty list distinguish "you have no returns" from "nothing here is configured to fetch returns" — which look identical on screen and mean opposite things.',
  })
  configured!: boolean;

  @ApiProperty({
    type: [String],
    description: 'The connections that declare it. Empty exactly when configured is false.',
  })
  connectionIds!: string[];
}
