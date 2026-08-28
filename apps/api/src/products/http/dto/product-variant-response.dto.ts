/**
 * Product Variant Response DTO
 *
 * Response shape for a single product variant. Dates are serialised as
 * ISO 8601 strings. External IDs are optionally included in detail responses.
 *
 * @module apps/api/src/products/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExternalIdMappingDto } from './external-id-mapping.dto';

export class ProductVariantResponseDto {
  @ApiProperty({ description: 'Internal variant ID' })
  id!: string;

  @ApiProperty({ description: 'Parent product ID' })
  productId!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Variant SKU' })
  sku!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Variant attributes (e.g. size, color)' })
  attributes!: Record<string, string> | null;

  @ApiPropertyOptional({ nullable: true, description: 'EAN barcode' })
  ean!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'GTIN barcode' })
  gtin!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Master variant price. Nullable when not yet synced or unavailable from the master source.',
  })
  price!: number | null;
  @ApiPropertyOptional({
    nullable: true,
    description:
      "The variant's OWN tax-rate override (#2054). null means no override — the product's " +
      'rate applies — never "no rate". Only a master that keys tax per variant sets it.',
  })
  taxRate?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Provenance country of the override.' })
  taxRateCountry?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'When the override was last read (ISO 8601); null when never read per variant.',
  })
  taxRateReadAt?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: ['not-configured', 'ambiguous', 'unreadable'],
    description:
      "Why the shop named no rate for this variant's own OVERRIDE (#2264), meaningful only " +
      'alongside a null taxRate with a non-null taxRateReadAt.',
  })
  taxRateUnknownReason?: string | null;


  @ApiProperty({ description: 'Creation timestamp (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({ description: 'Last update timestamp (ISO 8601)' })
  updatedAt!: string;

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

  @ApiPropertyOptional({ type: [ExternalIdMappingDto], description: 'External platform identifiers' })
  externalIds?: ExternalIdMappingDto[];
}
