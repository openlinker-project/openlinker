/**
 * Count Customers Query DTO (#2944)
 *
 * Query parameters for `GET /customers/count`.
 *
 * Derived from {@link ListCustomersQueryDto} with `OmitType` rather than
 * restated: the count must apply the identical filter surface to the list, and
 * a hand-copied second class is how the two drift apart until the total
 * describes a different set than the page. `limit` / `offset` / `withTotal`
 * are dropped because a count takes no page.
 *
 * @module apps/api/src/customers/http/dto
 */
import { OmitType } from '@nestjs/swagger';
import { ListCustomersQueryDto } from './list-customers-query.dto';

export class CountCustomersQueryDto extends OmitType(ListCustomersQueryDto, [
  'limit',
  'offset',
  'withTotal',
] as const) {}
