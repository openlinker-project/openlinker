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

  @ApiPropertyOptional({ description: 'ISO 8601 — last marketplace-side change' })
  updatedAt?: string;

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
      updatedAt: offer.updatedAt,
    };
  }
}
