/**
 * Category Mapping Input DTO
 *
 * Request body for upserting a single category mapping.
 *
 * @module apps/api/src/mappings/http/dto
 */

import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryMappingInputDto {
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
