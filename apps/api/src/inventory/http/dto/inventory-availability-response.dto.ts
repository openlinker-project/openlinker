/**
 * Inventory Availability Response DTO
 *
 * Response shape for `GET /inventory/availability` (#792 PR 2). One item
 * per requested variant ID; zero-filled when the variant has no inventory
 * rows.
 *
 * @module apps/api/src/inventory/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class InventoryAvailabilityItemDto {
  @ApiProperty({ description: 'Internal product-variant ID' })
  productVariantId!: string;

  @ApiProperty({
    description: 'Summed availableQuantity across all locations (0 when no inventory rows)',
  })
  totalAvailable!: number;

  @ApiProperty({
    description: 'Distinct location count contributing to the sum (0 when no inventory rows)',
  })
  locationCount!: number;
}

export class InventoryAvailabilityResponseDto {
  @ApiProperty({ type: [InventoryAvailabilityItemDto] })
  items!: InventoryAvailabilityItemDto[];
}
