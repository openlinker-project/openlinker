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
    description:
      'Distinct non-null locations contributing to the sum. A pooled position (no location, normal for most masters) counts 0, so 0 does NOT mean "no inventory rows"; use positionCount for that.',
  })
  locationCount!: number;

  @ApiProperty({
    description:
      'Number of live inventory positions (rows) for the variant, pooled ones included. 0 means the variant has no position, i.e. its stock was never synced.',
  })
  positionCount!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Units OpenLinker will promise (#2323): totalAvailable net of OpenLinker’s own ' +
      'published reservations, with NO per-destination stock safety buffer applied. ' +
      'null means availability could not be determined — never "zero", and never a ' +
      'reason to fall back to totalAvailable.',
  })
  availableToPromise!: number | null;
}

export class InventoryAvailabilityResponseDto {
  @ApiProperty({ type: [InventoryAvailabilityItemDto] })
  items!: InventoryAvailabilityItemDto[];
}
