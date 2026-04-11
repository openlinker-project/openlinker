/**
 * Paginated Offer Mappings Response DTO
 *
 * Response shape for GET /listings.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { OfferMappingResponseDto } from './offer-mapping-response.dto';

export class PaginatedOfferMappingsResponseDto {
  @ApiProperty({ type: [OfferMappingResponseDto] })
  items!: OfferMappingResponseDto[];

  @ApiProperty({ description: 'Total number of offer mappings matching the filters' })
  total!: number;

  @ApiProperty({ description: 'Page size used for this response' })
  limit!: number;

  @ApiProperty({ description: 'Offset used for this response' })
  offset!: number;
}
