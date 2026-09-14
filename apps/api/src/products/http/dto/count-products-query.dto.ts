/**
 * Count Products Query DTO (#2944)
 *
 * Query parameters for `GET /products/count`.
 *
 * Derived from {@link ListProductsQueryDto} with `OmitType` rather than
 * restated: the count must apply the identical filter surface to the list, and
 * a hand-copied second class is how the two drift apart until the total
 * describes a different set than the page. `limit` / `offset` / `withTotal` are
 * dropped because a count takes no page, and `sort` / `dir` because ordering
 * cannot change a count.
 *
 * @module apps/api/src/products/http/dto
 */
import { OmitType } from '@nestjs/swagger';
import { ListProductsQueryDto } from './list-products-query.dto';

export class CountProductsQueryDto extends OmitType(ListProductsQueryDto, [
  'limit',
  'offset',
  'withTotal',
  'sort',
  'dir',
] as const) {}
