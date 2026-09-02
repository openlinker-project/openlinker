/**
 * List Returns Query DTO (#2334)
 *
 * Query parameters for `GET /returns`. Every field is optional, and an absent
 * field does not filter — see `ReturnListFilter` for the rule this mirrors.
 *
 * @module apps/api/src/returns/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import {
  ReturnBucketValues,
  ReturnMoneyStateValues,
  ReturnSegmentValues,
  ReturnStageValues,
  type ReturnBucket,
  type ReturnMoneyState,
  type ReturnSegment,
  type ReturnStage,
} from '@openlinker/core/returns';
import { RefundReasonValues, type RefundReason } from '@openlinker/core/orders/types';

export class ListReturnsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by source connection ID (UUID)' })
  @IsOptional()
  @IsUUID()
  sourceConnectionId?: string;

  /**
   * Validated against the union's own runtime array, never against restated
   * literals — adding a bucket must not require finding this file.
   *
   * `isReturnBucket` is the coercion rule for an UNTRUSTED string; inside a
   * validated DTO the array is already the validator and the pipe has narrowed
   * the value before a controller sees it, so re-coercing downstream would be a
   * second rule for one question.
   */
  @ApiPropertyOptional({
    enum: ReturnBucketValues,
    description:
      'Which side of the attribution partition. "orphan" = OpenLinker could not name the order this return belongs to (every downstream trigger is blocked for it); "attributed" = the ordinary state. Omitted returns both.',
  })
  @IsOptional()
  @IsIn(ReturnBucketValues)
  bucket?: ReturnBucket;

  /**
   * One derived operator stage (#2377, spec § 4.3).
   *
   * Validated against the union's own runtime array for the reason `bucket`
   * gives. The stage is a PRESENTATION PROJECTION and not a column, so this
   * filters on the same `CASE` over the counters that the stage counts bucket
   * on — one expression, so a filtered page can never disagree with its own chip.
   */
  @ApiPropertyOptional({
    enum: ReturnStageValues,
    description:
      'One derived operator stage, computed from counters and timestamps — never a persisted column. Omitted returns every stage.',
  })
  @IsOptional()
  @IsIn(ReturnStageValues)
  stage?: ReturnStage;

  /**
   * One operator-facing segment (#2378, spec § 4.1) — the list's worklist strip.
   *
   * A SEPARATE dimension from `bucket`, deliberately: `orphans` is an ordinary
   * segment here rather than a translation of `bucket=orphan`, because the
   * segment counts strip the `segment` dimension and a translated value would
   * leave `bucket` applied — making the orphans card report the count of the
   * scope it is already in.
   *
   * This is a deliberate deviation from spec § 4.3's literal param list, which
   * names `attention=restock_blocked` and `orphan=true`: three of its own six
   * segments (`Needs receiving`, `Needs disposition`, `Money pending`) each span
   * two states and are not expressible as a value of any single-valued param.
   */
  @ApiPropertyOptional({
    enum: ReturnSegmentValues,
    description:
      "One operator-facing segment. Segments OVERLAP — a return can sit in several at once — so their counts do not sum to the total. Omitted returns every segment.",
  })
  @IsOptional()
  @IsIn(ReturnSegmentValues)
  segment?: ReturnSegment;

  @ApiPropertyOptional({
    enum: ReturnMoneyStateValues,
    description:
      "One money state. Single-valued: the `money_pending` SEGMENT is what expresses 'pending OR in_doubt'.",
  })
  @IsOptional()
  @IsIn(ReturnMoneyStateValues)
  money?: ReturnMoneyState;

  @ApiPropertyOptional({
    enum: RefundReasonValues,
    description:
      'One return reason. Reuses the refund vocabulary verbatim, so returns-by-reason and refunds-by-reason report on one axis by construction.',
  })
  @IsOptional()
  @IsIn(RefundReasonValues)
  reason?: RefundReason;

  /**
   * The SOURCE's own instant, never OpenLinker's ingestion clock — which is what
   * `createdFrom`/`createdTo` filter. Wiring this to those arms would answer a
   * question about the marketplace's timeline with OL's.
   */
  @ApiPropertyOptional({
    description: "Inclusive lower bound on the SOURCE's own opened instant (ISO 8601).",
  })
  @IsOptional()
  @IsDateString()
  openedFrom?: string;

  @ApiPropertyOptional({
    description: "Inclusive upper bound on the SOURCE's own opened instant (ISO 8601).",
  })
  @IsOptional()
  @IsDateString()
  openedTo?: string;

  @ApiPropertyOptional({ description: 'Returns created on or after this instant (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'Returns created on or before this instant (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  createdTo?: string;

  /**
   * The paging defaults are applied ONCE, in the controller — the `default:`
   * below is Swagger documentation, deliberately not a second initializer here.
   * A field default plus a `?? 20` downstream is two spellings of one value,
   * and they drift.
   */
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Page size' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0, description: 'Number of items to skip' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
