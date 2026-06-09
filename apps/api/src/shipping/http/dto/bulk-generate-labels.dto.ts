/**
 * Bulk Generate Labels DTO
 *
 * Request body for POST /shipments/bulk/generate-labels (#964). One shared
 * `sourceConnectionId` (the bulk scope) plus N per-order payloads. Each item is
 * the single-dispatch `GenerateLabelDto` minus `sourceConnectionId` (via
 * `OmitType`, which carries every nested validation rule), so the bulk and
 * single surfaces can't drift.
 *
 * Capped at 25 items (ADR-019): v1 dispatches synchronously by looping the
 * per-order seam — N sequential outbound calls in one request — so the cap
 * bounds request wall-clock. NOT the bulk-offer 100 cap (that surface fans out
 * to async workers). The cap is removable once the prepare/execute split or a
 * durable batch lands.
 *
 * @module apps/api/src/shipping/http/dto
 */
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID, ValidateNested } from 'class-validator';
import { ApiProperty, OmitType } from '@nestjs/swagger';
import { GenerateLabelDto } from './generate-label.dto';

/** A single order's dispatch payload within a bulk request (sans the shared connection). */
export class BulkDispatchItemDto extends OmitType(GenerateLabelDto, ['sourceConnectionId'] as const) {}

/** Max items per synchronous bulk dispatch (ADR-019 §"Synchronous-cap bound"). */
export const BULK_DISPATCH_MAX_ITEMS = 25;

export class BulkGenerateLabelsDto {
  @ApiProperty({ description: 'Order-source connection id shared by every item (the bulk scope)' })
  @IsUUID()
  sourceConnectionId!: string;

  @ApiProperty({
    type: [BulkDispatchItemDto],
    minItems: 1,
    maxItems: BULK_DISPATCH_MAX_ITEMS,
    description: `Per-order dispatch payloads (1..${BULK_DISPATCH_MAX_ITEMS}).`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_DISPATCH_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => BulkDispatchItemDto)
  items!: BulkDispatchItemDto[];
}
