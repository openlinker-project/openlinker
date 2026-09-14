/**
 * Paginated Product Variants Response DTO
 *
 * Response shape for GET /products/:productId/variants and GET /variants/search.
 *
 * @module apps/api/src/products/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductVariantResponseDto } from './product-variant-response.dto';

export class PaginatedProductVariantsResponseDto {
  @ApiProperty({ type: [ProductVariantResponseDto] })
  items!: ProductVariantResponseDto[];

  /**
   * Absent - not `0` - when the caller passed `?withTotal=false` (#2944).
   */
  @ApiPropertyOptional({
    description: 'Total number of variants matching the filters. Omitted when ?withTotal=false.',
  })
  total?: number;

  @ApiProperty({ description: 'Page size used for this response' })
  limit!: number;

  @ApiProperty({ description: 'Offset used for this response' })
  offset!: number;
}
