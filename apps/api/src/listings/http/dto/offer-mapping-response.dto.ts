/**
 * Offer Mapping Response DTO
 *
 * Response shape for a single offer mapping. Dates are serialised as ISO 8601 strings.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { OfferLifecycleValues } from '@openlinker/core/listings';
import { OfferLifecycle, OfferPublicationStatus } from '@openlinker/core/listings';

import { OfferCreationStatusResponseDto } from './offer-creation-status-response.dto';

export class OfferMappingIdentityResponseDto {
  @ApiProperty({ description: 'Internal product ID owning the linked variant' })
  productId!: string;

  @ApiProperty({ description: 'Catalog product name' })
  productName!: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Variant's distinguishing attribute values joined for display. Null for a simple product's synthetic variant.",
  })
  variantLabel!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Variant SKU' })
  sku!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Variant EAN/barcode' })
  ean!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Thumbnail URL. There is no dedicated thumbnail column, so this is the owning product’s first image (`products.images[0]`).',
  })
  imageUrl!: string | null;
}

export class OfferMappingChannelStatusResponseDto {
  @ApiProperty({
    description: 'Raw marketplace publication status observed on the last status sync',
  })
  publicationStatus!: OfferPublicationStatus;

  @ApiProperty({
    enum: OfferLifecycleValues,
    description:
      'Lifecycle bucket derived from `publicationStatus` plus the presence of validator messages. ' +
      'The four buckets are disjoint and partition the filtered total.',
  })
  lifecycle!: OfferLifecycle;

  @ApiProperty({
    type: [String],
    description: 'Marketplace validator messages; empty when the validator raised none',
  })
  validationMessages!: string[];

  @ApiProperty({ description: 'When the channel status was last read (ISO 8601)' })
  lastStatusSyncedAt!: string;
}

export class OfferMappingCommercialResponseDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Channel-side price. Null means "not reported by the marketplace", never zero.',
  })
  price!: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Channel-side price currency' })
  currency!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Channel-side available quantity. Null means "not reported by the marketplace", never zero.',
  })
  availableQuantity!: number | null;

  @ApiProperty({
    description:
      'When the price/quantity above were last read from the channel (ISO 8601). Always returned ' +
      'alongside the values: a both-null observation is deliberately never persisted, so a row can ' +
      'legitimately be days old and a price shown without its age is a price an operator acts on.',
  })
  lastCommercialSyncedAt!: string;
}

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

  @ApiPropertyOptional({
    nullable: true,
    type: OfferMappingIdentityResponseDto,
    description:
      'Catalog identity of the linked variant, resolved by a reporting join in the same query ' +
      '(#2025). Populated only by `GET /listings` (list endpoint). Null when `internalId` no ' +
      'longer resolves to a live variant. Absent on `GET /listings/:id`, which returns the ' +
      'mapping plus its own detail-only enrichments instead.',
  })
  identity?: OfferMappingIdentityResponseDto | null;

  @ApiPropertyOptional({
    nullable: true,
    type: OfferMappingChannelStatusResponseDto,
    description:
      'Live channel publication state from `offer_status_snapshots` (#816) plus the derived ' +
      'lifecycle bucket. Populated only by `GET /listings`. Null when no status has ever been ' +
      'read for the offer — a real, frequent state, not an error.',
  })
  channelStatus?: OfferMappingChannelStatusResponseDto | null;

  @ApiPropertyOptional({
    nullable: true,
    type: OfferMappingCommercialResponseDto,
    description:
      'Channel-side price/quantity from `offer_commercial_snapshots` (#2024) with their freshness ' +
      'timestamp. Populated only by `GET /listings`. Null when no commercial observation has been ' +
      'persisted for the offer yet.',
  })
  commercial?: OfferMappingCommercialResponseDto | null;
}
