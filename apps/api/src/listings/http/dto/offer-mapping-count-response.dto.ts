/**
 * Offer Mapping Count Response DTO (#2944)
 *
 * What `GET /listings/count` answers with: the shared
 * {@link PaginatedTotalResponseDto} shape plus this list's own lifecycle
 * buckets, so the second stage of a two-stage render is one request and not
 * two.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginatedTotalResponseDto } from '../../../common/dto/paginated-total-response.dto';
import { OfferLifecycleCountsResponseDto } from './paginated-offer-mappings-response.dto';

export class OfferMappingCountResponseDto extends PaginatedTotalResponseDto {
  @ApiPropertyOptional({
    type: OfferLifecycleCountsResponseDto,
    description:
      'Row count per lifecycle bucket under the SAME search/connection/variant filters, but ' +
      'deliberately NOT narrowed by `lifecycle` - otherwise selecting a tab would zero every ' +
      'other tab. Present only when the request set `includeLifecycleCounts`. When present, ' +
      '`total` is DERIVED from these buckets (they partition the filtered set) rather than from ' +
      'a second aggregate over the same join.',
  })
  lifecycleCounts?: OfferLifecycleCountsResponseDto;
}
