/**
 * List Offer Mappings Query DTO
 *
 * Query parameters for GET /listings. All fields are optional.
 *
 * @module apps/api/src/listings/http/dto
 */
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListOfferMappingsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by connection ID' })
  @IsOptional()
  @IsString()
  connectionId?: string;

  // The raw free-text `platformType` filter was dropped in #2025: the
  // redesigned toolbar scopes by connection (a select over the operator's own
  // connections), and a connection already implies its channel. Two Allegro
  // accounts are the common case, so filtering by platform string answered a
  // question nobody was asking while inviting typo'd, empty result sets.

  @ApiPropertyOptional({ description: 'Filter by linked internal ID (variant ID)' })
  @IsOptional()
  @IsString()
  internalId?: string;

  @ApiPropertyOptional({
    description:
      'Case-insensitive search across product name, variant label, SKU, EAN and the external offer ID',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Page size' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0, description: 'Number of items to skip' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
