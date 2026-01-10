/**
 * Update Offer Mapping DTO
 *
 * Request DTO for updating an existing offer mapping. Validates input and provides
 * Swagger documentation for the API endpoint.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateOfferMappingDto {
  @ApiPropertyOptional({
    description: 'Internal OpenLinker product ID',
    example: 'ol_product_abc123',
  })
  @IsString()
  @IsOptional()
  internalProductId?: string;

  @ApiPropertyOptional({
    description: 'Optional variant ID (set to null to clear)',
    example: 'ol_variant_xyz789',
  })
  @IsString()
  @IsOptional()
  variantId?: string | null;
}



