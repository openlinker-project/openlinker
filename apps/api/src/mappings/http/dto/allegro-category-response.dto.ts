/**
 * Allegro Category Response DTO
 *
 * Response shape for Allegro category tree browsing endpoints.
 *
 * @module apps/api/src/mappings/http/dto
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { MarketplaceCategory } from '@openlinker/core/integrations';

export class AllegroCategoryResponseDto {
  @ApiProperty({ example: '258066' })
  id!: string;

  @ApiProperty({ example: 'Smartphones' })
  name!: string;

  @ApiPropertyOptional({ example: '258060', nullable: true })
  parentId!: string | null;

  @ApiProperty({ example: true })
  leaf!: boolean;

  static fromDomain(cat: MarketplaceCategory): AllegroCategoryResponseDto {
    const dto = new AllegroCategoryResponseDto();
    dto.id = cat.id;
    dto.name = cat.name;
    dto.parentId = cat.parentId;
    dto.leaf = cat.leaf;
    return dto;
  }
}
