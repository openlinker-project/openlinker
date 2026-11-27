/**
 * Category Mapping Input DTO
 *
 * Request body for upserting a single category mapping.
 *
 * @module apps/api/src/mappings/http/dto
 */

import { IsString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryMappingInputDto {
  @ApiPropertyOptional({
    description:
      'Source (master) connection that owns the source category. The route connection is the ' +
      'marketplace the mapping is for (#3993). Send it on every write: without it a second write ' +
      'for the same category adds a duplicate row instead of updating this one. Omitting it is ' +
      'deprecated - it is still accepted for one release, writes a source-agnostic row and logs a ' +
      'warning, and will be required in the next release.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  sourceConnectionId?: string;

  @ApiProperty({ description: 'Allegro category ID', example: '258066' })
  @IsString()
  @IsNotEmpty()
  allegroCategoryId!: string;

  @ApiProperty({ description: 'Allegro category display name', example: 'Smartphones' })
  @IsString()
  @IsNotEmpty()
  allegroCategoryName!: string;

  @ApiPropertyOptional({ description: 'Allegro category breadcrumb path', example: 'Electronics > Phones > Smartphones' })
  @IsString()
  @IsOptional()
  allegroCategoryPath?: string;
}
