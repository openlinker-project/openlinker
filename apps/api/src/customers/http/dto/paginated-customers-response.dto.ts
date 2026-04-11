/**
 * Paginated Customers Response DTO
 *
 * Response shape for GET /customers.
 *
 * @module apps/api/src/customers/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { CustomerProjectionResponseDto } from './customer-projection-response.dto';

export class PaginatedCustomersResponseDto {
  @ApiProperty({ type: [CustomerProjectionResponseDto] })
  items!: CustomerProjectionResponseDto[];

  @ApiProperty({ description: 'Total number of customer projections matching the filters' })
  total!: number;

  @ApiProperty({ description: 'Page size used for this response' })
  limit!: number;

  @ApiProperty({ description: 'Offset used for this response' })
  offset!: number;
}
