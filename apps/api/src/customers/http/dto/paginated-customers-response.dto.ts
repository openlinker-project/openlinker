/**
 * Paginated Customers Response DTO
 *
 * Response shape for GET /customers.
 *
 * @module apps/api/src/customers/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerProjectionResponseDto } from './customer-projection-response.dto';

export class PaginatedCustomersResponseDto {
  @ApiProperty({ type: [CustomerProjectionResponseDto] })
  items!: CustomerProjectionResponseDto[];

  /**
   * Absent - not `0` - when the caller passed `?withTotal=false` (#2944). A
   * caller that reads it as a row count must therefore treat `undefined` as
   * "not asked for", never as "none matched".
   */
  @ApiPropertyOptional({
    description:
      'Total number of customer projections matching the filters. Omitted when ?withTotal=false.',
  })
  total?: number;

  @ApiProperty({ description: 'Page size used for this response' })
  limit!: number;

  @ApiProperty({ description: 'Offset used for this response' })
  offset!: number;
}
