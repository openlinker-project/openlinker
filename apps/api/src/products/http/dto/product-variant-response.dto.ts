/**
 * Product Variant Response DTO
 *
 * Response shape for a single product variant. Dates are serialised as
 * ISO 8601 strings. External IDs are optionally included in detail responses.
 *
 * @module apps/api/src/products/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExternalIdMappingDto } from './external-id-mapping.dto';

export class ProductVariantResponseDto {
  @ApiProperty({ description: 'Internal variant ID' })
  id!: string;

  @ApiProperty({ description: 'Parent product ID' })
  productId!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Variant SKU' })
  sku!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Variant attributes (e.g. size, color)' })
  attributes!: Record<string, string> | null;

  @ApiPropertyOptional({ nullable: true, description: 'EAN barcode' })
  ean!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'GTIN barcode' })
  gtin!: string | null;

  @ApiProperty({ description: 'Creation timestamp (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({ description: 'Last update timestamp (ISO 8601)' })
  updatedAt!: string;

  @ApiPropertyOptional({ type: [ExternalIdMappingDto], description: 'External platform identifiers' })
  externalIds?: ExternalIdMappingDto[];
}
