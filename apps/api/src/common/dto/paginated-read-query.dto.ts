/**
 * Paginated Read Query DTO (#2944)
 *
 * The `withTotal` opt-out shared by every list route whose count is expensive.
 *
 * A paged read stops after its `LIMIT`; the `COUNT` beside it cannot stop at
 * all, so under a predicate no plain index serves - a jsonb containment, an
 * `ILIKE`, a function-wrapped column - the count scans the table however small
 * the page is. `?withTotal=false` asks for the page alone; the total is then
 * fetched from the route's sibling `/count` endpoint, which takes the same
 * filters and no pagination.
 *
 * Declared once and inherited rather than copied onto four query DTOs:
 * class-validator and `@nestjs/swagger` both read inherited members, and one
 * definition is what keeps the four routes answering to the same spelling.
 *
 * @module apps/api/src/common/dto
 * @see PaginatedTotalResponseDto for what the sibling `/count` route returns
 */
import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PaginatedReadQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    default: true,
    description:
      'Include the `total` in the response. Pass `false` to skip the COUNT and receive the ' +
      'page alone - the response then omits `total` entirely rather than reporting 0. Fetch ' +
      "the total separately from this route's sibling `/count` endpoint.",
  })
  @IsOptional()
  // Query params arrive as strings, so map the two literals and pass anything
  // else THROUGH unchanged for `@IsBoolean()` to reject with a 400 - the house
  // idiom (`list-orders-query.dto.ts`, `list-shipments-query.dto.ts`). Mapping
  // a stray value to `undefined` would make `?withTotal=maybe` silently pay for
  // the count the caller asked to skip.
  @Transform(({ value }): unknown => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  withTotal?: boolean;
}
