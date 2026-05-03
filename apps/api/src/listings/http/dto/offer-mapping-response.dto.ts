/**
 * Offer Mapping Response DTO
 *
 * Response shape for a single offer mapping. Dates are serialised as ISO 8601 strings.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { OfferCreationStatusResponseDto } from './offer-creation-status-response.dto';

export class OfferMappingResponseDto {
  @ApiProperty({ description: 'Mapping row ID' })
  id!: string;

  @ApiProperty({ description: 'Entity type (always Offer)' })
  entityType!: string;

  @ApiProperty({ description: 'Internal ID (linked variant ID)' })
  internalId!: string;

  @ApiProperty({ description: 'External offer ID on the platform' })
  externalId!: string;

  @ApiProperty({ description: 'Platform type (e.g. allegro, prestashop)' })
  platformType!: string;

  @ApiProperty({ description: 'Connection ID' })
  connectionId!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Mapping context metadata' })
  context!: Record<string, unknown> | null;

  @ApiProperty({ description: 'Creation timestamp (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({ description: 'Last update timestamp (ISO 8601)' })
  updatedAt!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: OfferCreationStatusResponseDto,
    description:
      'Populated only by `GET /listings/:id` (detail endpoint) for Offer-type ' +
      'mappings that originated from an OL-initiated create. Always absent on ' +
      'list responses (`GET /listings`) regardless of creation history — the ' +
      'list does not fan-out lookups per row. Absent on synced-in offers and ' +
      'on non-Offer entity types (Product, Inventory, etc.).',
  })
  offerCreation?: OfferCreationStatusResponseDto | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Internal product ID owning the linked variant. Populated only by ' +
      '`GET /listings/:id` (detail endpoint) for Offer-type mappings whose ' +
      '`internalId` resolves to an existing variant. Drives the AI-suggest ' +
      'flow on the offer-edit drawer (#485) — the suggest endpoint is keyed ' +
      'on product, not variant. Absent on list responses, synced-in offers ' +
      'whose variant has been deleted, and non-Offer entity types.',
  })
  linkedProductId?: string | null;
}
