/**
 * Bulk Accept Price Changes DTO (#3145)
 *
 * `@ArrayMaxSize` + per-item `expectedVersion` (#3162 review — BLOCKING):
 * this DTO shipped with `@ArrayMinSize(1)` and no upper bound, unlike every
 * sibling bulk DTO in this folder (`bulk-offer-create.dto.ts` caps at 100/
 * 1000, `resolve-category.dto.ts` at 32) — combined with an unbounded
 * "Select all" on the FE and the previously-unbounded list read, one click
 * could POST tens of thousands of items. And the item carried no
 * `expectedVersion`, which is why `bulkAccept` could not pass one to the
 * staleness guard — the guard the single-item `accept`/`edit` paths already
 * enforce.
 *
 * @module apps/api/src/listings/http/dto
 */
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Matches `bulk-offer-create.dto.ts`'s per-batch ceiling. */
const MAX_BULK_ACCEPT_ITEMS = 100;

export class BulkAcceptPriceChangeItemDto {
  @ApiProperty({ description: 'The price-change episode id.' })
  @IsString()
  id!: string;

  @ApiPropertyOptional({ description: "Also set this item's (source, connection) pair to `automatic`." })
  @IsOptional()
  @IsBoolean()
  optInAutomatic?: boolean;

  @ApiPropertyOptional({
    description:
      'The episode version last seen by the caller — the staleness guard (mirrors the single-accept path). Omitted means "accept whatever the server currently has".',
  })
  @IsOptional()
  @IsString()
  expectedVersion?: string;
}

export class BulkAcceptPriceChangesDto {
  @ApiProperty({ type: [BulkAcceptPriceChangeItemDto], maxItems: MAX_BULK_ACCEPT_ITEMS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_ACCEPT_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => BulkAcceptPriceChangeItemDto)
  items!: BulkAcceptPriceChangeItemDto[];
}
