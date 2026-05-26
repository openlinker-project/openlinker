/**
 * Paginated Shipments Response DTO
 *
 * Response envelope for GET /shipments. Mirrors `PaginatedSyncJobsResponseDto`
 * (items + total + limit + offset).
 *
 * @module apps/api/src/shipping/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { ShipmentResponseDto } from './shipment-response.dto';

export class PaginatedShipmentsResponseDto {
  @ApiProperty({ type: [ShipmentResponseDto] })
  items!: ShipmentResponseDto[];

  @ApiProperty({ description: 'Total number of shipments matching the filters' })
  total!: number;

  @ApiProperty({ description: 'Page size used for this response' })
  limit!: number;

  @ApiProperty({ description: 'Offset used for this response' })
  offset!: number;
}
