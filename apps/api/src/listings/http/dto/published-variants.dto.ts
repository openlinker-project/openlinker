/**
 * Published Variants DTOs
 *
 * Request/response shapes for the destination-aware duplicate guard (#1837):
 * `POST /listings/published-variants` reports which of the supplied variant ids
 * are already published on a destination connection (an offer mapping for a
 * marketplace, a shop-product mapping for an online shop).
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class PublishedVariantsRequestDto {
  @ApiProperty({ description: 'Destination connection id to check against' })
  @IsString()
  connectionId!: string;

  @ApiProperty({
    description: 'Internal variant ids to check for an existing listing on the connection',
    type: [String],
    maxItems: 1000,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  variantIds!: string[];
}

export class PublishedVariantsResponseDto {
  @ApiProperty({
    description: 'Subset of the requested variant ids already published on the connection',
    type: [String],
  })
  publishedVariantIds!: string[];
}
