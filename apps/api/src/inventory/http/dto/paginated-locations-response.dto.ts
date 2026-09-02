/**
 * Paginated Inventory Locations Response DTO
 *
 * Response shape for GET /inventory/locations (#2316). Echoes the 1-based
 * `page`/`limit` the core `PaginatedInventoryLocations` contract returns.
 *
 * @module apps/api/src/inventory/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { LocationResponseDto } from './location-response.dto';

export class PaginatedLocationsResponseDto {
  @ApiProperty({ type: [LocationResponseDto] })
  items!: LocationResponseDto[];

  @ApiProperty({ description: 'Total rows matching the filters, ignoring pagination' })
  total!: number;

  @ApiProperty({ description: '1-based page number echoed back' })
  page!: number;

  @ApiProperty()
  limit!: number;
}
