/**
 * Paginated Orders Response DTO
 *
 * Response shape for GET /orders.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { OrderRecordResponseDto } from './order-record-response.dto';

export class PaginatedOrdersResponseDto {
  @ApiProperty({ type: [OrderRecordResponseDto] })
  items!: OrderRecordResponseDto[];

  @ApiProperty({ description: 'Total number of orders matching the filters' })
  total!: number;

  @ApiProperty({ description: 'Page size used for this response' })
  limit!: number;

  @ApiProperty({ description: 'Offset used for this response' })
  offset!: number;
}
