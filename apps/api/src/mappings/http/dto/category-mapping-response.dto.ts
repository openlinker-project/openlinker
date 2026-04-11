/**
 * Category Mapping Response DTO
 *
 * Response shape for category mapping endpoints.
 *
 * @module apps/api/src/mappings/http/dto
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CategoryMapping } from '@openlinker/core/mappings';

export class CategoryMappingResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  connectionId!: string;

  @ApiProperty()
  prestashopCategoryId!: string;

  @ApiProperty()
  allegroCategoryId!: string;

  @ApiProperty()
  allegroCategoryName!: string;

  @ApiPropertyOptional()
  allegroCategoryPath!: string | null;

  static fromDomain(m: CategoryMapping): CategoryMappingResponseDto {
    const dto = new CategoryMappingResponseDto();
    dto.id = m.id;
    dto.connectionId = m.connectionId;
    dto.prestashopCategoryId = m.prestashopCategoryId;
    dto.allegroCategoryId = m.allegroCategoryId;
    dto.allegroCategoryName = m.allegroCategoryName;
    dto.allegroCategoryPath = m.allegroCategoryPath;
    return dto;
  }
}
