/**
 * Paginated Offer Mappings Response DTO
 *
 * Response shape for GET /listings.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { OfferMappingResponseDto } from './offer-mapping-response.dto';

/**
 * Per-bucket row counts backing the lifecycle tab bar (#2026).
 *
 * Keys are the `OfferLifecycle` values verbatim, so the FE indexes this by the
 * same token it reads off each row's `channelStatus.lifecycle` - no second
 * naming to keep in sync.
 */
export class OfferLifecycleCountsResponseDto {
  @ApiProperty({ description: 'Offers live on the channel, including mid-transition ones' })
  Active!: number;

  @ApiProperty({ description: 'Offers the channel validator rejected (they carry messages)' })
  Inactive!: number;

  @ApiProperty({ description: 'Offers that never went live and carry no validator messages' })
  Draft!: number;

  @ApiProperty({ description: 'Offers the channel reports as ended' })
  Ended!: number;

  @ApiProperty({
    description:
      'Mappings with no status snapshot at all - no status has EVER been read. Not a promise ' +
      'that one will be: on a connection whose status-sync task is not scheduled this is ' +
      'permanent. See the per-row `channelStatus.lifecycle` docs.',
  })
  Unsynced!: number;
}

export class PaginatedOfferMappingsResponseDto {
  @ApiProperty({ type: [OfferMappingResponseDto] })
  items!: OfferMappingResponseDto[];

  @ApiProperty({
    description:
      'Total number of offer mappings matching the filters - including `lifecycle`, so it is the ' +
      'size of the selected tab when one is selected and paging inside a tab stays correct.',
  })
  total!: number;

  @ApiProperty({
    type: OfferLifecycleCountsResponseDto,
    description:
      'Row count per lifecycle bucket under the SAME search/connection/variant filters as the ' +
      'list, but deliberately NOT narrowed by `lifecycle` - otherwise selecting a tab would zero ' +
      'every other tab. The buckets partition the filtered set, so they sum to the `total` ' +
      'reported for the same request without a `lifecycle` filter.',
  })
  lifecycleCounts!: OfferLifecycleCountsResponseDto;

  @ApiProperty({ description: 'Page size used for this response' })
  limit!: number;

  @ApiProperty({ description: 'Offset used for this response' })
  offset!: number;
}
