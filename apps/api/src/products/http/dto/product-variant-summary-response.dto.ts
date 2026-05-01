/**
 * Product Variant Summary Response DTO
 *
 * Lightweight projection of `ProductVariant` returned by
 * `GET /products/variants/:variantId`. Scoped to the fields the listing-detail
 * page (#464) needs to enrich the Internal ID row inline (parent product id,
 * SKU, EAN, optional variant name). Distinct from `ProductVariantResponseDto`
 * — that DTO carries `attributes` / `gtin` / timestamps; this one is a tiny
 * read-side projection that the FE can render in a single span without
 * additional plumbing.
 *
 * @module apps/api/src/products/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProductVariantSummaryResponseDto {
  @ApiProperty({ description: 'Internal variant ID', example: 'ol_variant_xxx' })
  id!: string;

  @ApiProperty({ description: 'Internal parent product ID', example: 'ol_product_xxx' })
  productId!: string;

  @ApiProperty({ description: 'Variant SKU', nullable: true })
  sku!: string | null;

  @ApiProperty({ description: 'Variant EAN', nullable: true })
  ean!: string | null;

  @ApiPropertyOptional({
    description: 'Display label assembled from variant attributes (e.g. "Red / 42")',
  })
  name?: string;
}
