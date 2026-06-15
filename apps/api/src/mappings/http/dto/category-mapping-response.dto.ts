/**
 * Category Mapping Response DTO
 *
 * Response shape for category mapping endpoints.
 *
 * @module apps/api/src/mappings/http/dto
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CategoryMapping } from '@openlinker/core/mappings';

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

  // #1036: the core entity is neutralised (source/destination), but the HTTP
  // wire shape keeps the Allegro/PrestaShop field names until the FE follow-up
  // neutralises the contract. This DTO is the mapping seam.
  static fromDomain(m: CategoryMapping): CategoryMappingResponseDto {
    const dto = new CategoryMappingResponseDto();
    dto.id = m.id;
    dto.connectionId = m.destinationConnectionId;
    dto.prestashopCategoryId = m.sourceCategoryId;
    dto.allegroCategoryId = m.destinationCategoryId;
    dto.allegroCategoryName = m.destinationCategoryName;
    dto.allegroCategoryPath = m.destinationCategoryPath;
    return dto;
  }
}
