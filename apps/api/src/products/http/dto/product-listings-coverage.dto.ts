/**
 * Product Listings Coverage DTO
 *
 * Per-connection listed-variant count for one product on the list response
 * (#1720 - products catalog cockpit coverage pills).
 *
 * @module apps/api/src/products/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class ProductListingsCoverageDto {
  @ApiProperty({ description: 'Connection ID the coverage row belongs to' })
  connectionId!: string;

  @ApiProperty({ description: 'Platform type of the connection (e.g. allegro)' })
  platformType!: string;

  @ApiProperty({
    description: 'Count of DISTINCT variants of this product with at least one Offer mapping on the connection',
  })
  listedVariants!: number;
}
