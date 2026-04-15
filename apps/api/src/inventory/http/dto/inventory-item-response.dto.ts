/**
 * Inventory Item Response DTO
 *
 * Response shape for a single inventory item. Used in both list and detail responses.
 * Dates are serialised as ISO 8601 strings.
 *
 * @module apps/api/src/inventory/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InventoryItemResponseDto {
  @ApiProperty({ description: 'Inventory item UUID' })
  id!: string;

  @ApiProperty({ description: 'Internal product ID' })
  productId!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Internal product variant ID (null for product-level inventory)' })
  productVariantId!: string | null;

  @ApiProperty({ description: 'Available stock quantity' })
  availableQuantity!: number;

  @ApiProperty({ description: 'Reserved stock quantity' })
  reservedQuantity!: number;

  @ApiPropertyOptional({ nullable: true, description: 'Location ID (null for default location)' })
  locationId!: string | null;

  @ApiProperty({ description: 'Last update timestamp (ISO 8601)' })
  updatedAt!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Product name from the master catalog (null if product not found)' })
  productName!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Product SKU from the master catalog (null if product not found or no SKU)' })
  productSku!: string | null;
}
