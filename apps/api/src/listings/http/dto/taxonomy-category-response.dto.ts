/**
 * Destination Taxonomy Response DTOs (#2074)
 *
 * Neutral marketplace + shop taxonomy reads. Deliberately NOT reusing
 * `AllegroCategoryResponseDto` (platform-named, and its `leaf` is non-nullable)
 * nor `ShopCategoryResponseDto` (no `leaf` at all): this surface spans both
 * destination kinds, and in a read model that difference is data, not a type
 * fork — ADR-024's reasoning applied to the response shape.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { CategoryPathSegment, DestinationCategoryLike } from '@openlinker/core/listings';

export class TaxonomyCategoryResponseDto {
  @ApiProperty({ example: '258066' })
  id!: string;

  @ApiProperty({ example: 'Smartphones' })
  name!: string;

  @ApiPropertyOptional({ example: '258060', nullable: true })
  parentId!: string | null;

  /**
   * `null` for a shop node — a shop accepts a product in any node, so it has no
   * leaf concept (ADR-024). A marketplace node always carries a boolean.
   */
  @ApiPropertyOptional({ example: true, nullable: true })
  leaf!: boolean | null;

  /**
   * Takes the structural `DestinationCategoryLike`, not the entity: `search`
   * returns hits under that shape while `browse` returns entities, and the
   * entity satisfies it — so one mapper serves both rather than two that drift.
   */
  static fromDomain(category: DestinationCategoryLike): TaxonomyCategoryResponseDto {
    const dto = new TaxonomyCategoryResponseDto();
    dto.id = category.externalId;
    dto.name = category.name;
    dto.parentId = category.parentId;
    dto.leaf = category.leaf;
    return dto;
  }
}

export class TaxonomyCategoryPathSegmentDto {
  @ApiProperty({ example: '258060' })
  id!: string;

  @ApiProperty({ example: 'Elektronika' })
  name!: string;
}

export class TaxonomySearchHitResponseDto {
  @ApiProperty({ type: TaxonomyCategoryResponseDto })
  category!: TaxonomyCategoryResponseDto;

  /**
   * Root -> leaf breadcrumb. Carried on every hit because a search result from
   * anywhere in the tree is unintelligible without it — the operator has not
   * drilled to it and has no other context for "Buty".
   */
  @ApiProperty({ type: [TaxonomyCategoryPathSegmentDto] })
  path!: TaxonomyCategoryPathSegmentDto[];
}

export function toPathSegmentDtos(
  path: readonly CategoryPathSegment[],
): TaxonomyCategoryPathSegmentDto[] {
  return path.map((segment) => ({ id: segment.id, name: segment.name }));
}
