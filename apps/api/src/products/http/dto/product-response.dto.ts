/**
 * Product Response DTO
 *
 * Response shape for a single product. Dates are serialised as ISO 8601 strings.
 * Variants and external IDs are optionally included in detail responses.
 *
 * @module apps/api/src/products/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductVariantResponseDto } from './product-variant-response.dto';
import { ExternalIdMappingDto } from './external-id-mapping.dto';

export class ProductResponseDto {
  @ApiProperty({ description: 'Internal product ID' })
  id!: string;

  @ApiProperty({ description: 'Product name' })
  name!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Product SKU' })
  sku!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Product price' })
  price!: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Product description' })
  description!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Product image URLs' })
  images!: string[] | null;

  @ApiProperty({ description: 'Creation timestamp (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({ description: 'Last update timestamp (ISO 8601)' })
  updatedAt!: string;

  @ApiPropertyOptional({ type: [ProductVariantResponseDto], description: 'Product variants (detail only)' })
  variants?: ProductVariantResponseDto[];

  @ApiPropertyOptional({ type: [ExternalIdMappingDto], description: 'External platform identifiers (detail only)' })
  externalIds?: ExternalIdMappingDto[];
}
