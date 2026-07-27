/**
 * Marketplace Offer Response DTO
 *
 * Wire shape for `GET /listings/:mappingId/offer` (#464). Mirrors the neutral
 * `MarketplaceOffer` domain DTO 1:1; published as a plain class so NestJS can
 * generate Swagger schema without leaking the domain type.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { MarketplaceOffer } from '@openlinker/core/listings';
import { CategoryParameterSectionValues } from '@openlinker/core/listings';

class MarketplaceOfferPriceDto {
  @ApiProperty({ description: 'Decimal string preserving precision', example: '99.99' })
  amount!: string;

  @ApiProperty({ description: 'ISO 4217 currency code', example: 'PLN' })
  currency!: string;
}

class MarketplaceOfferCategoryDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional()
  name?: string;
}

class MarketplaceOfferParameterRangeDto {
  @ApiProperty()
  from!: string;

  @ApiProperty()
  to!: string;
}

class MarketplaceOfferParameterDto {
  @ApiProperty({ description: 'Marketplace-native parameter id' })
  id!: string;

  @ApiPropertyOptional({
    description: 'Human-readable label; absent when the marketplace omits it on reads',
  })
  name?: string;

  @ApiProperty({ type: [String], description: 'Human-readable values when provided' })
  values!: string[];

  @ApiPropertyOptional({ type: [String], description: 'Dictionary value ids when provided' })
  valuesIds?: string[];

  @ApiPropertyOptional({ type: MarketplaceOfferParameterRangeDto })
  rangeValue?: MarketplaceOfferParameterRangeDto;

  @ApiProperty({ enum: CategoryParameterSectionValues })
  section!: (typeof CategoryParameterSectionValues)[number];
}

class MarketplaceOfferProductSetItemDto {
  @ApiPropertyOptional({
    description: 'Marketplace catalog product id (absent for inline products)',
  })
  productId?: string;

  @ApiPropertyOptional({ description: 'Units of the catalog product per offer item' })
  quantity?: number;
}

export class MarketplaceOfferResponseDto {
  @ApiProperty({ description: 'Marketplace-native offer id' })
  externalId!: string;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({ description: 'Description preview (raw text/HTML)' })
  description?: string;

  @ApiPropertyOptional({ description: 'Public primary-image URL' })
  imageUrl?: string;

  @ApiProperty({ type: MarketplaceOfferPriceDto })
  price!: MarketplaceOfferPriceDto;

  @ApiProperty()
  availableQuantity!: number;

  @ApiProperty({
    description: 'Marketplace lifecycle status (string passthrough — no closed enum)',
    example: 'ACTIVE',
  })
  status!: string;

  @ApiPropertyOptional({ type: MarketplaceOfferCategoryDto })
  category?: MarketplaceOfferCategoryDto;

  @ApiPropertyOptional({ description: 'Public buyer-facing URL' })
  marketplaceUrl?: string;

  @ApiPropertyOptional({
    description:
      "ISO 8601 — when the offer's marketplace-side validity ends (Allegro: publication.endingAt). Optional; not every marketplace publishes a fixed end date.",
  })
  endsAt?: string;

  @ApiPropertyOptional({
    type: [MarketplaceOfferParameterDto],
    description:
      'Filled category-parameter values (#1482). Absent for adapters whose native read carries no parameter data.',
  })
  parameters?: MarketplaceOfferParameterDto[];

  @ApiPropertyOptional({
    type: [MarketplaceOfferProductSetItemDto],
    description: 'Product-set linkage for catalog-grouped offers (#1482).',
  })
  productSet?: MarketplaceOfferProductSetItemDto[];

  static fromDomain(offer: MarketplaceOffer): MarketplaceOfferResponseDto {
    return {
      externalId: offer.externalId,
      title: offer.title,
      description: offer.description,
      imageUrl: offer.imageUrl,
      price: { amount: offer.price.amount, currency: offer.price.currency },
      availableQuantity: offer.availableQuantity,
      status: offer.status,
      category: offer.category ? { id: offer.category.id, name: offer.category.name } : undefined,
      marketplaceUrl: offer.marketplaceUrl,
      endsAt: offer.endsAt,
      parameters: offer.parameters?.map((parameter) => ({
        id: parameter.id,
        name: parameter.name,
        values: parameter.values,
        valuesIds: parameter.valuesIds,
        rangeValue: parameter.rangeValue
          ? { from: parameter.rangeValue.from, to: parameter.rangeValue.to }
          : undefined,
        section: parameter.section,
      })),
      productSet: offer.productSet?.map((entry) => ({
        productId: entry.productId,
        quantity: entry.quantity,
      })),
    };
  }
}
