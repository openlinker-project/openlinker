/**
 * Count Offer Mappings Query DTO (#2944)
 *
 * Query parameters for `GET /listings/count`.
 *
 * Derived from {@link ListOfferMappingsQueryDto} with `OmitType` rather than
 * restated: the count must apply the identical filter surface to the list, and
 * a hand-copied second class is how the two drift apart until the total
 * describes a different set than the page. `limit` / `offset` / `withTotal` are
 * dropped because a count takes no page.
 *
 * `includeLifecycleCounts` is deliberately KEPT. On this list the total is
 * derived from the lifecycle buckets whenever the tab bar is on screen (they
 * partition the filtered set, so their sum IS the total), so asking for them
 * here means the second stage is one request rather than two.
 *
 * @module apps/api/src/listings/http/dto
 */
import { OmitType } from '@nestjs/swagger';
import { ListOfferMappingsQueryDto } from './list-offer-mappings-query.dto';

export class CountOfferMappingsQueryDto extends OmitType(ListOfferMappingsQueryDto, [
  'limit',
  'offset',
  'withTotal',
] as const) {}
