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
  ReturnStageValues,
  type ReturnBucket,
  type ReturnStage,
} from '@openlinker/core/returns';

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
