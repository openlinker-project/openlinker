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

  @ApiProperty({
    type: [String],
    description:
      'Proxy paths (relative to the API) of the pictures this variant is shown with: its own, ' +
      "or the product's when it has none. Empty when neither has any. Never a shop url.",
  })
  imageUrls!: string[];

  @ApiProperty({
    description:
      "true when the variant has no pictures of its own and imageUrls are the product's; " +
      'false when it has its own, or when there are none at all.',
  })
  imagesFromProduct!: boolean;

  @ApiProperty({
    description:
      'Whether this variant was deleted at the master (absent from the master catalog, or the product 404s). Its offers are auto-paused.',
  })
  isStale!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Timestamp of the most recent stale-marking; null while the variant is live.',
  })
  staleAt!: string | null;
}
