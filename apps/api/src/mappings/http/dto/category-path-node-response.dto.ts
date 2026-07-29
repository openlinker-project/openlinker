/**
 * Category Path Node Response DTO
 *
 * One ancestor node in a marketplace category breadcrumb, returned ROOT -> LEAF
 * by the source-category path endpoint. Consumed by the bulk-offer wizard chip
 * to render a human breadcrumb for an EAN-auto-resolved category id.
 *
 * @module apps/api/src/mappings/http/dto
 */

import { ApiProperty } from '@nestjs/swagger';
import type { CategoryPathSegment } from '@openlinker/core/listings';

export class CategoryPathNodeResponseDto {
  @ApiProperty({ example: '258066' })
  id!: string;

  @ApiProperty({ example: 'Smartphones' })
  name!: string;

  static fromDomain(node: CategoryPathSegment): CategoryPathNodeResponseDto {
    const dto = new CategoryPathNodeResponseDto();
    dto.id = node.id;
    dto.name = node.name;
    return dto;
  }
}
