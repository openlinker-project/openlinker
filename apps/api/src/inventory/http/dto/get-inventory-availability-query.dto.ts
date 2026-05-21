/**
 * Get Inventory Availability Query DTO
 *
 * Query-parameter shape for `GET /inventory/availability` (#792 PR 2).
 * Accepts a comma-separated list of internal product-variant IDs and
 * transforms it into `string[]` before validation. Capped at 200 entries
 * per request; empty lists are rejected with 400.
 *
 * @module apps/api/src/inventory/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

const MAX_VARIANT_IDS_PER_REQUEST = 200;

export class GetInventoryAvailabilityQueryDto {
  @ApiProperty({
    description:
      'Comma-separated list of internal product-variant IDs (max 200). Returns one row per ID, zero-filled for variants with no inventory.',
    example: 'ol_variant_abc123,ol_variant_def456',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : value
  )
  @IsArray()
  @ArrayMinSize(1, { message: 'productVariantIds must contain at least one ID' })
  @ArrayMaxSize(MAX_VARIANT_IDS_PER_REQUEST, {
    message: `productVariantIds may contain at most ${MAX_VARIANT_IDS_PER_REQUEST.toString()} IDs per request`,
  })
  @IsString({ each: true })
  productVariantIds!: string[];
}

/**
 * Server-side cap on per-request variant-ID count. Re-exported so the FE
 * hook can dedupe / chunk against the same constant if a caller ever
 * passes more than this many IDs.
 */
export const INVENTORY_AVAILABILITY_MAX_VARIANT_IDS = MAX_VARIANT_IDS_PER_REQUEST;
