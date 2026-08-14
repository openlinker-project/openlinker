/**
 * Taxonomy Search Query DTO (#2074)
 *
 * Validates the destination-taxonomy search query at the interface boundary.
 * Two concrete bugs make this more than a formality:
 *
 * - `limit` arrives from the query string as a STRING, so it needs coercion
 *   before it reaches a service that treats it as a number.
 * - An empty `q` becomes `LIKE '%%'` in the repository, which matches every row
 *   in the scope and returns an arbitrary `limit`-sized slice — a "search" that
 *   silently means "give me anything". A minimum length is the guard.
 *
 * The service still clamps `limit` at its own maximum; this DTO is the
 * boundary, not a replacement for that clamp.
 *
 * @module apps/api/src/listings/http/dto
 */
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

/** Below this, a query is noise rather than a search. Mirrored by the FE (#2075). */
export const TAXONOMY_SEARCH_MIN_QUERY_LENGTH = 2;

export class TaxonomySearchQueryDto {
  @IsString()
  @MinLength(TAXONOMY_SEARCH_MIN_QUERY_LENGTH)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
