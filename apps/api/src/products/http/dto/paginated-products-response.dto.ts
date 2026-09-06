/**
 * Paginated Products Response DTO
 *
 * Response shape for GET /products.
 *
 * @module apps/api/src/products/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductResponseDto } from './product-response.dto';

export class PaginatedProductsResponseDto {
  @ApiProperty({ type: [ProductResponseDto] })
  items!: ProductResponseDto[];

  /**
   * Absent - not `0` - when the caller passed `?withTotal=false` (#2944).
   */
  @ApiPropertyOptional({
    description: 'Total number of products matching the filters Omitted when ?withTotal=false.',
  })
  total?: number;

  @ApiProperty({ description: 'Page size used for this response' })
  limit!: number;

  @ApiProperty({ description: 'Offset used for this response' })
  offset!: number;
}
