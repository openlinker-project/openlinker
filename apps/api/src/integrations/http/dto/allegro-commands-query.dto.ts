/**
 * Allegro Commands Query DTO
 *
 * Query parameter DTO for filtering Allegro quantity commands when listing.
 * All fields are optional.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { IsOptional, IsEnum, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AllegroQuantityCommandStatusValues } from '@openlinker/integrations-allegro';

export class AllegroCommandsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by status',
    enum: AllegroQuantityCommandStatusValues,
    example: 'accepted',
  })
  @IsEnum(AllegroQuantityCommandStatusValues)
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({
    description: 'Maximum number of commands to return',
    example: 50,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({
    description: 'Number of commands to skip',
    example: 0,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  offset?: number;
}

