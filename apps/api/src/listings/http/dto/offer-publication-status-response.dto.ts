/**
 * Offer Publication Status DTOs
 *
 * Response shapes for the operator-facing live offer publication-status read
 * (#1760): the persisted `offer_status_snapshots` (#816) exposed per product,
 * plus the manual single-offer refresh. Publication status is the neutral
 * `OfferPublicationStatus` union — distinct from the OL-side creation lifecycle
 * (`OfferCreationStatus`) surfaced by the creation-status endpoint.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import {
  type OfferPublicationStatus,
  OfferPublicationStatusValues,
} from '@openlinker/core/listings';

export class OfferPublicationStatusResponseDto {
  @ApiProperty({ description: 'Marketplace connection the offer belongs to' })
  connectionId!: string;

  @ApiProperty({ description: 'Marketplace-native offer id' })
  externalOfferId!: string;

  @ApiProperty({ description: 'Internal OL variant the offer is mapped to' })
  internalVariantId!: string;

  @ApiProperty({
    enum: OfferPublicationStatusValues,
    description: 'Live marketplace publication status as of the last sync',
  })
  publicationStatus!: OfferPublicationStatus;

  @ApiPropertyOptional({
    type: [String],
    description: 'Marketplace validation messages captured with the status, if any',
  })
  validationMessages?: string[];

  @ApiProperty({ description: 'When the status was last read from the marketplace (ISO 8601)' })
  lastStatusSyncedAt!: string;
}

/** Body for the manual single-offer refresh: the variant to key the snapshot to. */
export class RefreshOfferPublicationStatusDto {
  @ApiProperty({ description: 'Internal OL variant the offer is mapped to' })
  @IsString()
  @IsNotEmpty()
  internalVariantId!: string;
}

export class RefreshOfferPublicationStatusResponseDto {
  @ApiProperty({
    enum: OfferPublicationStatusValues,
    description: 'Live marketplace publication status observed by the refresh',
  })
  publicationStatus!: OfferPublicationStatus;
}
