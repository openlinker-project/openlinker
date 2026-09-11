/**
 * Paginated Orders Response DTO
 *
 * Response shape for GET /orders.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderRecordResponseDto } from './order-record-response.dto';

export class PaginatedOrdersResponseDto {
  @ApiProperty({ type: [OrderRecordResponseDto] })
  items!: OrderRecordResponseDto[];

  /**
   * Absent - not `0` - when the caller passed `?withTotal=false` (#2944). A
   * caller that reads it as a row count must therefore treat `undefined` as
   * "not asked for", never as "none matched".
   */
  @ApiPropertyOptional({
    description: 'Total number of orders matching the filters. Omitted when ?withTotal=false.',
  })
  total?: number;

  @ApiProperty({ description: 'Page size used for this response' })
  limit!: number;

  @ApiProperty({ description: 'Offset used for this response' })
  offset!: number;
}
