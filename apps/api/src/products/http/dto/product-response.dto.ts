/**
 * Product Response DTO
 *
 * Response shape for a single product. Dates are serialised as ISO 8601 strings.
 * Variants and external IDs are optionally included in detail responses.
 *
 * @module apps/api/src/products/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductVariantResponseDto } from './product-variant-response.dto';
import { ExternalIdMappingDto } from './external-id-mapping.dto';
import { ProductListingsCoverageDto } from './product-listings-coverage.dto';

export class ProductResponseDto {
  @ApiProperty({ description: 'Internal product ID' })
  id!: string;

  @ApiProperty({ description: 'Product name' })
  name!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Product SKU' })
  sku!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Product price' })
  price!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'ISO 4217 currency code (e.g., PLN, EUR), resolved from the master catalog at sync time. Null when the adapter did not provide a currency.',
  })
  currency!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Product description' })
  description!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Product image URLs' })
  images!: string[] | null;

  @ApiPropertyOptional({
    nullable: true,
    type: [String],
    description:
      'Source-platform external category ids (#1034), populated at product sync. ' +
      'Drives the per-source-category mapping fallback in the bulk-offer wizard (#1522). ' +
      'Null until a sync populates it.',
  })
  categories!: string[] | null;

  @ApiPropertyOptional({
    type: 'array',
    items: {
      type: 'object',
      properties: { name: { type: 'string' }, value: { type: 'string' } },
    },
    description:
      'Source-platform product-level attributes (#1752), e.g. Brand / Material. ' +
      'Distinct from variant-distinguishing attributes. Absent until a sync populates it.',
  })
  features?: { name: string; value: string }[];

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Neutral tax-rate code the shop stated (#2054): "23", "8", "5", "0", "zw", "np", "oo". ' +
      'null means the shop stated none — which, paired with a non-null taxRateReadAt, is a ' +
      'DIFFERENT fact from never having been asked.',
  })
  taxRate?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'ISO 3166-1 alpha-2 the rate was resolved against. Provenance only.',
  })
  taxRateCountry?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'When the shop was last asked for a rate (ISO 8601). null means NEVER — the only thing ' +
      'that separates "the shop has no rate" from "nobody has looked", and on the day this ' +
      'ships it is the whole catalogue.',
  })
  taxRateReadAt?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: ['not-configured', 'ambiguous', 'unreadable'],
    description:
      'Why the shop named no rate (#2264), meaningful only when taxRateReadAt is set and ' +
      'taxRate is null. null means no reason was recorded, which is NOT "not-configured" ' +
      '(a real answer the shop gave). "ambiguous" is the case a plain taxRate:null cannot ' +
      'tell apart from a shop with none configured at all.',
  })
  taxRateUnknownReason?: string | null;

  @ApiProperty({ description: 'Creation timestamp (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({ description: 'Last update timestamp (ISO 8601)' })
  updatedAt!: string;

  @ApiPropertyOptional({ type: [ProductVariantResponseDto], description: 'Product variants (detail only)' })
  variants?: ProductVariantResponseDto[];

  @ApiPropertyOptional({ type: [ExternalIdMappingDto], description: 'External platform identifiers (detail and list)' })
  externalIds?: ExternalIdMappingDto[];

  @ApiPropertyOptional({
    description:
      'Total available quantity summed across the product inventory rows (#1720, list only; zero-filled when the product has no inventory rows)',
  })
  totalAvailable?: number;

  @ApiPropertyOptional({
    description: 'Total reserved quantity summed across the product inventory rows (#1720, list only)',
  })
  totalReserved?: number;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Most recent inventory write for the product (ISO 8601; #1720, list only). Null when the product has no inventory rows.',
  })
  stockUpdatedAt?: string | null;

  @ApiPropertyOptional({ description: 'Number of variants of the product (#1720, list only)' })
  variantCount?: number;

  @ApiPropertyOptional({
    type: [ProductListingsCoverageDto],
    description: 'Per-connection listed-variant counts (#1720, list only)',
  })
  listingsCoverage?: ProductListingsCoverageDto[];
}
