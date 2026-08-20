/**
 * Offer Mapping Response DTO
 *
 * Response shape for a single offer mapping. Dates are serialised as ISO 8601 strings.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Inline `type` modifiers in ONE statement, deliberately: `eslint --fix` merges
// a separate `import type` line from this module back into the value import,
// and drops the `type` keyword while doing it (which then trips
// consistent-type-imports). The inline form is the only shape stable under fix.
import {
  OfferLifecycleValues,
  OfferValidationScopeValues,
  type OfferLifecycle,
  type OfferPublicationStatus,
  type OfferValidationScope,
} from '@openlinker/core/listings';

import { OfferCreationStatusResponseDto } from './offer-creation-status-response.dto';

export class OfferMappingIdentityResponseDto {
  @ApiProperty({ description: 'Internal product ID owning the linked variant' })
  productId!: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Catalog product name. `products.name` is NOT NULL behind a real FK, so null here means a ' +
      'corrupt row - reported rather than rendered as a blank cell.',
  })
  productName!: string | null;

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

  @ApiProperty({
    description:
      'Whether the linked variant is stale (#1689) - its master record is gone, either because ' +
      'the product was deleted or because this one variant disappeared from the master. Its ' +
      'offers should have been paused, but do not assume the quantity is zero: on a connection ' +
      'with seller-frozen stock the pause is a documented no-op. `isStale` together with a ' +
      'non-zero `commercial.availableQuantity` is therefore a live listing for a product that no ' +
      'longer exists - the overselling case, and worth louder treatment than a stale chip.',
  })
  isStale!: boolean;
}

export class OfferValidationProblemResponseDto {
  @ApiProperty({
    description:
      "The platform's OWN code, verbatim (e.g. Erli `missingTaxRate`). Never translated and never " +
      'invented: it is what an operator quotes in a support ticket and what a maintainer greps for ' +
      "in the platform's docs. Empty string when the platform reported a message with no code.",
  })
  code!: string;

  @ApiPropertyOptional({
    description:
      'One short line, for a surface with exactly one line to spend (the /listings row). Absent when ' +
      'the adapter supplied only a full sentence - fall back to `message`.',
  })
  summary?: string;

  @ApiProperty({
    description: 'The operator-facing sentence: what is wrong and what to change.',
  })
  message!: string;

  @ApiProperty({
    enum: OfferValidationScopeValues,
    description:
      '`offer` - about this listing. `account` - about the seller\'s shop on the channel, reported by ' +
      'the platform against EVERY one of its offers; render it once per connection, not once per row.',
  })
  scope!: OfferValidationScope;
}

export class OfferMappingChannelStatusResponseDto {
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Raw marketplace publication status observed on the last status sync. Null exactly when ' +
      '`lifecycle` is `Unsynced`.',
  })
  publicationStatus!: OfferPublicationStatus | null;

  @ApiProperty({
    enum: OfferLifecycleValues,
    description:
      'Lifecycle bucket. Four buckets are derived from `publicationStatus` plus the presence of ' +
      'validator messages; the fifth, `Unsynced`, means no status has ever been read for this ' +
      'mapping. All five are disjoint and together partition the filtered total. Note this is ' +
      'five buckets, not the four of the #1965 mockup - a deliberate #2025 decision, because most ' +
      'of a large catalog carries no snapshot for days. `Unsynced` is NOT a promise that it will ' +
      'resolve shortly: a successful wizard create lands here too (the creation poller reconciles ' +
      'only on timeout and draft, not on the active branch), and on a connection whose status-sync ' +
      'task is not scheduled - Erli is strict opt-in and default OFF - it is permanent. It also ' +
      'does NOT mean unlisted: the duplicate guard reads an absent snapshot as still-listed, so ' +
      'such a row still blocks a re-list.',
  })
  lifecycle!: OfferLifecycle;

  @ApiProperty({
    type: [String],
    description: 'Marketplace validator messages; empty when the validator raised none',
  })
  validationMessages!: string[];

  @ApiProperty({
    type: [OfferValidationProblemResponseDto],
    description:
      'The same refusals in structured form (#2231): the platform\'s own code, a one-line summary, ' +
      'and the scope that decides where each belongs on screen - `offer` on the row, `account` once ' +
      'per connection. Empty on a snapshot written before #2231; fall back to `validationMessages`.',
  })
  validationProblems!: OfferValidationProblemResponseDto[];

  @ApiPropertyOptional({
    nullable: true,
    description:
      'When the channel status was last read (ISO 8601). Null exactly when `lifecycle` is ' +
      '`Unsynced`.',
  })
  lastStatusSyncedAt!: string | null;
}

export class OfferMappingCommercialResponseDto {
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      "Price the CHANNEL reports for this offer - already net of the connection's `pricingRule` " +
      '(#1843), not OL\'s own catalog price. Surface it as "on channel", never as OL\'s price. ' +
      'Null means "not reported by the marketplace", never zero. A DECIMAL STRING (e.g. "99.99"), ' +
      'not a number (#2032 review thread 6) - `numeric` round-trips through Postgres/TypeORM as a ' +
      'string specifically to avoid float64 precision loss; convert at render time only.',
  })
  price!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Channel-side price currency' })
  currency!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Quantity the CHANNEL reports as available - already net of the connection's " +
      '`stockSafetyBuffer` (#1844), so it can legitimately sit below master stock. Surface it as ' +
      '"on channel", never as OL\'s own stock, or a correctly-configured buffer reads as a bug. ' +
      'Null means "not reported by the marketplace", never zero.',
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
      'lifecycle bucket. Populated on EVERY row of `GET /listings`: when no status has ever been ' +
      'read for the offer — a real, frequent state, not an error — it carries ' +
      '`lifecycle: "Unsynced"` with a null `publicationStatus`/`lastStatusSyncedAt`. Absent (not ' +
      'null) on `GET /listings/:id`.',
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
