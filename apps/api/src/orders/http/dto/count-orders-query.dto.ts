/**
 * Count Orders Query DTO (#2944)
 *
 * Query parameters for `GET /orders/count`.
 *
 * Derived from {@link ListOrdersQueryDto} with `OmitType` rather than restated:
 * this list carries sixteen filters, the count must apply every one of them
 * identically, and a hand-copied second class is how the two drift apart until
 * the total describes a different set than the page. `limit` / `offset` /
 * `withTotal` are dropped because a count takes no page.
 *
 * **`sort` and `dir` are deliberately KEPT, accepted and ignored.** A count
 * cannot be ordered, so the handler never forwards them - but on this list they
 * live inside the FILTER object rather than beside it (`OrderFilters.sort`), so
 * a client that reuses one query builder for both routes emits them here too,
 * and `main.ts` runs the pipe with `forbidNonWhitelisted: true`. Omitting them
 * therefore turns the orders total into a 400 on every request that carries the
 * default triage sort - which is every request the list page makes. Accepting
 * them costs nothing and does not depend on each client remembering to strip a
 * parameter, the same accepted-but-ignored posture `ListOfferMappingsQueryDto`
 * takes for its deprecated `platformType`.
 *
 * `/products/count` needs no such carve-out: there `sort` is a separate
 * argument to the query builder, not a filter field, so it is never emitted.
 *
 * @module apps/api/src/orders/http/dto
 */
import { OmitType } from '@nestjs/swagger';
import { ListOrdersQueryDto } from './list-orders-query.dto';

export class CountOrdersQueryDto extends OmitType(ListOrdersQueryDto, [
  'limit',
  'offset',
  'withTotal',
] as const) {}
