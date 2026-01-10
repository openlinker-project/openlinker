/**
 * Offer Mapping Response DTO
 *
 * Response DTO for offer mapping operations. Maps domain entities to API response format.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OfferMapping } from '@openlinker/core/listings';

export class OfferMappingResponseDto {
  @ApiProperty({
    description: 'Offer mapping ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'Connection ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  connectionId!: string;

  @ApiProperty({
    description: 'Platform type',
    example: 'allegro',
  })
  platformType!: string;

  @ApiProperty({
    description: 'Marketplace offer ID',
    example: '12345678',
  })
  offerId!: string;

  @ApiProperty({
    description: 'Internal OpenLinker product ID',
    example: 'ol_product_abc123',
  })
  internalProductId!: string;

  @ApiPropertyOptional({
    description: 'Optional variant ID',
    example: 'ol_variant_xyz789',
  })
  variantId?: string | null;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2025-01-01T12:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2025-01-01T12:00:00.000Z',
  })
  updatedAt!: Date;

  /**
   * Map domain entity to response DTO
   */
  static fromDomain(mapping: OfferMapping): OfferMappingResponseDto {
    const dto = new OfferMappingResponseDto();
    dto.id = mapping.id;
    dto.connectionId = mapping.connectionId;
    dto.platformType = mapping.platformType;
    dto.offerId = mapping.offerId;
    dto.internalProductId = mapping.internalProductId;
    dto.variantId = mapping.variantId;
    dto.createdAt = mapping.createdAt;
    dto.updatedAt = mapping.updatedAt;
    return dto;
  }
}


