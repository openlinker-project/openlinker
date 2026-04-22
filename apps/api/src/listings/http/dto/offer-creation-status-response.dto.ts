/**
 * Offer Creation Status Response DTO
 *
 * Response shape for `GET /listings/connections/:connectionId/offers/creation/:offerCreationRecordId`.
 * Flat view of the `OfferCreationRecord` with ISO-string timestamps.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { OfferCreationError, OfferCreationStatus, OfferCreationStatusValues } from '@openlinker/core/listings';

import { OfferCreationRequestPayloadDto } from './offer-creation-request-payload-response.dto';

export class OfferCreationErrorDto {
  @ApiPropertyOptional({ description: 'Dotted field path reported by the platform' })
  field?: string;

  @ApiProperty({ description: 'Machine-readable error code' })
  code!: string;

  @ApiProperty({ description: 'Human-readable message' })
  message!: string;
}

export class OfferCreationStatusResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'OpenLinker internal variant id being listed' })
  internalVariantId!: string;

  @ApiProperty({ description: 'Connection id this record belongs to' })
  connectionId!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Marketplace-native offer id. Null until the adapter returns.',
  })
  externalOfferId!: string | null;

  @ApiProperty({ enum: OfferCreationStatusValues })
  status!: OfferCreationStatus;

  @ApiPropertyOptional({
    nullable: true,
    type: [OfferCreationErrorDto],
    description: 'Structured errors populated when status=failed.',
  })
  errors!: OfferCreationError[] | null;

  @ApiProperty()
  publishImmediately!: boolean;

  @ApiProperty({ description: 'ISO 8601 timestamp of record creation' })
  createdAt!: string;

  @ApiProperty({ description: 'ISO 8601 timestamp of the last update' })
  updatedAt!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: OfferCreationRequestPayloadDto,
    description:
      'Debug-only: snapshot of the original create-offer request payload. Drives the wizard retry pre-fill. Null for records predating this change or for records created through code paths that do not capture the snapshot.',
  })
  request?: OfferCreationRequestPayloadDto | null;
}
