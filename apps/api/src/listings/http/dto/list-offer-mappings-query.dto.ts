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

  @ApiPropertyOptional({ description: 'Filter by platform type (e.g. allegro)' })
  @IsOptional()
  @IsString()
  platformType?: string;

  @ApiPropertyOptional({ description: 'Filter by linked internal ID (variant ID)' })
  @IsOptional()
  @IsString()
  internalId?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive search on external ID' })
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
