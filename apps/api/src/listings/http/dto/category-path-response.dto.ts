/**
 * Category Path Response DTO
 *
 * Wire shape returned by
 * `GET /listings/connections/:connectionId/categories/:categoryId/path`
 * (#1752). Carries the resolved category breadcrumb ordered root -> leaf, so
 * the listing-detail drawer can render "Root > ... > Leaf" instead of the raw
 * category id Allegro's offer payload carries.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class CategoryPathSegmentResponseDto {
  @ApiProperty({ description: 'Marketplace-issued category id.' })
  id!: string;

  @ApiProperty({ description: 'Human-readable category name (operator-language).' })
  name!: string;
}

export class CategoryPathResponseDto {
  @ApiProperty({
    type: [CategoryPathSegmentResponseDto],
    description: 'Breadcrumb segments ordered root -> leaf.',
  })
  path!: CategoryPathSegmentResponseDto[];
}
