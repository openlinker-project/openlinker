/**
 * Category Mapping Query DTO
 *
 * Optional source-connection scope for listing and deleting category mappings
 * of a marketplace connection (#3993).
 *
 * @module apps/api/src/mappings/http/dto
 */

import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryMappingQueryDto {
  @ApiPropertyOptional({
    description:
      'Source (master) connection. When given, only mappings that apply to it are listed or ' +
      'deleted: its own and the source-agnostic historical ones.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  sourceConnectionId?: string;
}
