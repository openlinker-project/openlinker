/**
 * Create Offer Mapping DTO
 *
 * Request DTO for creating a new offer mapping. Validates input and provides
 * Swagger documentation for the API endpoint.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { IsString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOfferMappingDto {
  @ApiProperty({
    description: 'Connection ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  connectionId!: string;

  @ApiProperty({
    description: 'Platform type (e.g., allegro)',
    example: 'allegro',
  })
  @IsString()
  @IsNotEmpty()
  platformType!: string;

  @ApiProperty({
    description: 'Marketplace offer ID',
    example: '12345678',
  })
  @IsString()
  @IsNotEmpty()
  offerId!: string;

  @ApiProperty({
    description: 'Internal OpenLinker product ID',
    example: 'ol_product_abc123',
  })
  @IsString()
  @IsNotEmpty()
  internalProductId!: string;

  @ApiPropertyOptional({
    description: 'Optional variant ID',
    example: 'ol_variant_xyz789',
  })
  @IsString()
  @IsOptional()
  variantId?: string | null;
}


