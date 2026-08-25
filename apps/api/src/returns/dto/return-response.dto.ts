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
  type ReturnBucket,
  type ReturnCustodyState,
  type ReturnDeclineUnsupportedReason,
  type ReturnDisposition,
  type ReturnMoneyState,
  type ReturnOrigin,
} from '@openlinker/core/returns';
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

/** The hydrated aggregate: the header above, plus its lines and the decline fact. */
export class ReturnResponseDto extends ReturnListItemResponseDto {
  @ApiProperty({ type: [ReturnLineResponseDto], description: 'Ordered by lineIndex.' })
  lines!: ReturnLineResponseDto[];

  @ApiProperty({ type: ReturnDeclineAvailabilityDto })
  declineAvailability!: ReturnDeclineAvailabilityDto;
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
