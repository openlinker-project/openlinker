/**
 * Count Orders Query DTO (#2944)
 *
 * Query parameters for `GET /orders/count`.
 *
 * Derived from {@link ListOrdersQueryDto} with `OmitType` rather than restated:
 * this list carries sixteen filters, the count must apply every one of them
 * identically, and a hand-copied second class is how the two drift apart until
 * the total describes a different set than the page. `limit` / `offset` /
 * `withTotal` are dropped because a count takes no page, and `sort` / `dir`
 * because ordering cannot change a count.
 *
 * @module apps/api/src/orders/http/dto
 */
import { OmitType } from '@nestjs/swagger';
import { ListOrdersQueryDto } from './list-orders-query.dto';

export class CountOrdersQueryDto extends OmitType(ListOrdersQueryDto, [
  'limit',
  'offset',
  'withTotal',
  'sort',
  'dir',
] as const) {}
