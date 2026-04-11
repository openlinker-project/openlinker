/**
 * Mapping Option Response DTO
 *
 * Single option item returned by helper endpoints used to populate
 * FE dropdowns (Allegro/PrestaShop available values).
 *
 * @module apps/api/src/mappings/http/dto
 */

import { ApiProperty } from '@nestjs/swagger';

export class MappingOptionResponseDto {
  @ApiProperty({ description: 'Option value used in mapping configuration' })
  value!: string;

  @ApiProperty({ description: 'Human-readable label for display' })
  label!: string;
}
