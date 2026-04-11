/**
 * Paginated Inventory Response DTO
 *
 * Response shape for GET /inventory.
 *
 * @module apps/api/src/inventory/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { InventoryItemResponseDto } from './inventory-item-response.dto';

export class PaginatedInventoryResponseDto {
  @ApiProperty({ type: [InventoryItemResponseDto] })
  items!: InventoryItemResponseDto[];

  @ApiProperty({ description: 'Total number of items matching the filters' })
  total!: number;

  @ApiProperty({ description: 'Page size used for this response' })
  limit!: number;

  @ApiProperty({ description: 'Offset used for this response' })
  offset!: number;
}
