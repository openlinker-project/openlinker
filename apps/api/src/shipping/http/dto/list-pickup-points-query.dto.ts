/**
 * List Pickup-Points Query DTO
 *
 * Query parameters for GET /pickup-points. `connectionId` selects which
 * shipping-provider connection to search (its credentials hit the provider's
 * points API); the rest narrow the provider-side search. Maps 1:1 to the
 * core `FindPickupPointsQuery`.
 *
 * @module apps/api/src/shipping/http/dto
 */
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ListPickupPointsQueryDto {
  @ApiProperty({ description: 'Shipping-provider connection id (UUID) to search' })
  @IsUUID()
  connectionId!: string;

  @ApiPropertyOptional({ description: 'Free-text search (provider-defined)' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  searchText?: string;

  @ApiPropertyOptional({ description: 'City filter' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  city?: string;

  @ApiPropertyOptional({ description: 'Postal code filter' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  postalCode?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Max results' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
