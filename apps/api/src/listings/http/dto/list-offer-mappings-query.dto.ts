/**
 * List Offer Mappings Query DTO
 *
 * Query parameters for GET /listings. All fields are optional.
 *
 * @module apps/api/src/listings/http/dto
 */
import { IsOptional, IsString, IsInt, IsIn, IsBoolean, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

// Inline `type` modifier in ONE statement, deliberately: `eslint --fix` merges
// a separate `import type` line from this module back into the value import
// (see the same note in `offer-mapping-response.dto.ts`).
import { OfferLifecycleValues, type OfferLifecycle } from '@openlinker/core/listings';

export class ListOfferMappingsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by connection ID' })
  @IsOptional()
  @IsString()
  connectionId?: string;

  // The raw free-text `platformType` filter's FILTERING BEHAVIOUR was dropped
  // in #2025: the redesigned toolbar scopes by connection (a select over the
  // operator's own connections), and a connection already implies its
  // channel. Two Allegro accounts are the common case, so filtering by
  // platform string answered a question nobody was asking while inviting
  // typo'd, empty result sets.
  //
  // The PARAMETER stays on the DTO, deprecated and accepted-but-ignored
  // (#2032 review thread 2): `main.ts` runs `forbidNonWhitelisted: true`, so
  // dropping the field outright turns any existing `?platformType=allegro`
  // caller - a saved script, a bookmarked request, a third-party client
  // built against the current Swagger - into a hard 400 instead of a
  // silently-broader 200. Safe to remove for real once the deprecation has
  // had a release to be noticed.
  @ApiPropertyOptional({
    deprecated: true,
    description:
      'Deprecated, ignored (#2025): filtering by platform string is superseded by connectionId. ' +
      'Kept on the DTO so an existing caller gets a 200, not a 400, under `forbidNonWhitelisted`.',
  })
  @IsOptional()
  @IsString()
  platformType?: string;

  @ApiPropertyOptional({ description: 'Filter by linked internal ID (variant ID)' })
  @IsOptional()
  @IsString()
  internalId?: string;

  @ApiPropertyOptional({
    description:
      'Case-insensitive search across product name, variant label, product SKU, variant SKU, EAN, ' +
      'GTIN and the external offer ID. Leading/trailing whitespace is trimmed.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: OfferLifecycleValues,
    description:
      'Restrict the page to one lifecycle bucket (#2026). Server-side, so selecting a tab pages ' +
      'through that bucket across the whole catalog - filtering the returned page client-side ' +
      'would report an empty tab to a seller whose matching offers all sit past page 1. Does NOT ' +
      'affect `lifecycleCounts`, which always describes every bucket under the other filters.',
  })
  @IsOptional()
  @IsIn(OfferLifecycleValues)
  lifecycle?: OfferLifecycle;

  // Off by default (#2032 review thread 3): the counts are a second full
  // aggregate over the same four-join set `findMany` already scans, and
  // three OTHER callers share this endpoint purely for its enriched mapping
  // row - `variant-stock-table.tsx` / `product-row-detail.tsx` (one call per
  // rendered variant) and `use-nav-counts.ts` (`limit: 1`, fired on every
  // app-shell render) - none of which ever render a tab bar. Making them pay
  // for the aggregate unconditionally was the "worse than the redundancy"
  // half of the finding: a 24-variant product page ran 24 grouped aggregates
  // over the whole Offer-mapping table, all discarded by the caller. Only
  // `listings-list-page.tsx` sets this.
  @ApiPropertyOptional({
    default: false,
    description:
      'Compute `lifecycleCounts` alongside the page (#2026). Off by default - the aggregate is a ' +
      "second full scan over the four-join set, and a caller that doesn't render a tab bar " +
      'must not pay for one.',
  })
  @IsOptional()
  @Transform(({ value }): unknown =>
    value === 'true' ? true : value === 'false' ? false : value
  )
  @IsBoolean()
  includeLifecycleCounts?: boolean = false;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Page size' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0, description: 'Number of items to skip' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
