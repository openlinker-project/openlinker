/**
 * Paginated Offer Mappings Response DTO
 *
 * Response shape for GET /listings.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { OfferLifecycle } from '@openlinker/core/listings';
import { OfferMappingResponseDto } from './offer-mapping-response.dto';

/**
 * Per-bucket row counts backing the lifecycle tab bar (#2026).
 *
 * Keys are the `OfferLifecycle` values verbatim, so the FE indexes this by the
 * same token it reads off each row's `channelStatus.lifecycle` - no second
 * naming to keep in sync.
 *
 * `implements Record<OfferLifecycle, number>` is the compile-time pin that
 * makes this class break on a sixth bucket like every other producer does.
 * Without it the class is a hand-written five-field shape assigned from a
 * `Record<OfferLifecycle, number>` VARIABLE - no excess-property check fires on
 * a variable, so a sixth bucket would ship in the JSON body while being absent
 * from the Swagger schema the FE (#2029) generates against, with nothing
 * failing to compile.
 */
export class OfferLifecycleCountsResponseDto implements Record<OfferLifecycle, number> {
  @ApiProperty({ description: 'Offers live on the channel, including mid-transition ones' })
  Active!: number;

  @ApiProperty({
    description:
      'Offers the channel validator rejected (they carry messages). Named Invalid, not Inactive ' +
      "(#2032 review thread 9) - Allegro's own INACTIVE already means \"not live\", which this " +
      "bucket is not. NOTE: these still count as already-listed for the duplicate guard, so " +
      'their variants cannot be re-listed through the offer wizard - only Ended can.',
  })
  Invalid!: number;

  @ApiProperty({
    description:
      'Offers not live on the channel, with no validator messages. Deliberately NOT "never went ' +
      'live": a deliberately deactivated formerly-live offer reads as inactive too, as does an ' +
      'Erli offer whose status OL does not recognise. NOTE: like Invalid, these count as ' +
      'already-listed for the duplicate guard and cannot be re-listed through the offer wizard.',
  })
  Draft!: number;

  @ApiProperty({
    description:
      'Offers the channel reports as ended - the only bucket whose variants the offer wizard will ' +
      're-list.',
  })
  Ended!: number;

  @ApiProperty({
    description:
      'Mappings with no status snapshot at all - no status has EVER been read. Not a promise ' +
      'that one will be: on a connection whose status-sync task is not scheduled this is ' +
      'permanent. It also does not mean "unlisted" - the duplicate guard reads an absent ' +
      'snapshot as still-listed, so these too cannot be re-listed through the offer wizard. ' +
      'See the per-row `channelStatus.lifecycle` docs.',
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

  @ApiPropertyOptional({
    type: OfferLifecycleCountsResponseDto,
    description:
      'Row count per lifecycle bucket under the SAME search/connection/variant filters as the ' +
      'list, but deliberately NOT narrowed by `lifecycle` - otherwise selecting a tab would zero ' +
      'every other tab. The buckets partition the filtered set, so they sum to the `total` ' +
      'reported for the same request without a `lifecycle` filter. Present only when the request ' +
      'set `includeLifecycleCounts` (#2032 review thread 3) - omitted otherwise, since computing ' +
      'it costs a second full scan a caller with no tab bar to feed must not pay for.',
  })
  lifecycleCounts?: OfferLifecycleCountsResponseDto;

  @ApiProperty({ description: 'Page size used for this response' })
  limit!: number;

  @ApiProperty({ description: 'Offset used for this response' })
  offset!: number;
}
