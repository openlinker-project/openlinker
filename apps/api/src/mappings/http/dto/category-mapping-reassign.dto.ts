/**
 * Category Mapping Reassign DTOs
 *
 * Request and response for moving category mappings saved under one
 * connection onto the marketplace in the route (#3993).
 *
 * @module apps/api/src/mappings/http/dto
 */

import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { CategoryMappingReassignResult } from '@openlinker/core/mappings';

export class CategoryMappingReassignInputDto {
  @ApiProperty({
    description:
      'Connection the mappings are currently saved under. For mappings the Category Mappings page ' +
      'saved before #3993, this is the master connection.',
    format: 'uuid',
  })
  @IsUUID()
  fromConnectionId!: string;
}

export class CategoryMappingReassignResponseDto {
  @ApiProperty({ description: 'Mappings now keyed by the route marketplace.' })
  moved!: number;

  @ApiProperty({
    description:
      'Source categories that already had a mapping on the route marketplace. That mapping was ' +
      'kept and the moved one dropped.',
    type: [String],
  })
  keptSourceCategoryIds!: string[];

  static fromDomain(result: CategoryMappingReassignResult): CategoryMappingReassignResponseDto {
    const dto = new CategoryMappingReassignResponseDto();
    dto.moved = result.moved;
    dto.keptSourceCategoryIds = result.keptSourceCategoryIds;
    return dto;
  }
}
