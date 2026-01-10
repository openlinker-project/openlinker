/**
 * Connection Filters DTO
 *
 * Query parameter DTO for filtering connections when listing.
 * All fields are optional.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ConnectionStatusValues } from '@openlinker/core/identifier-mapping';

export class ConnectionFiltersDto {
  @ApiPropertyOptional({
    description: 'Filter by platform type',
    example: 'prestashop',
  })
  @IsString()
  @IsOptional()
  platformType?: string;

  @ApiPropertyOptional({
    description: 'Filter by connection status',
    enum: ConnectionStatusValues,
    example: 'active',
  })
  @IsEnum(ConnectionStatusValues)
  @IsOptional()
  status?: 'active' | 'disabled' | 'error';
}

