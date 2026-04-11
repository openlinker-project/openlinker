/**
 * Paginated Products Response DTO
 *
 * Response shape for GET /products.
 *
 * @module apps/api/src/products/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { ProductResponseDto } from './product-response.dto';

export class PaginatedProductsResponseDto {
  @ApiProperty({ type: [ProductResponseDto] })
  items!: ProductResponseDto[];

  @ApiProperty({ description: 'Total number of products matching the filters' })
  total!: number;

  @ApiProperty({ description: 'Page size used for this response' })
  limit!: number;

  @ApiProperty({ description: 'Offset used for this response' })
  offset!: number;
}
