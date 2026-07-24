/**
 * Shop Publish Request DTOs
 *
 * Request DTOs for the shop-publish endpoints (#1044). The single-publish DTO
 * maps to `EnqueueProductPublishInput`; the bulk DTO to `BulkShopPublishSubmitInput`.
 * Category placement + parameters are resolved server-side by the #1042 builder,
 * so the operator supplies only variant + visibility + stock (+ optional price /
 * content overrides) — far lighter than the offer-create DTO.
 *
 * @module apps/api/src/listings/http/dto
 */
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  PublishProductStatusValues,
  PublishTaxStatusValues,
  type PublishProductStatus,
  type PublishTaxStatus,
} from '@openlinker/core/listings';

const VARIANT_ID_PATTERN = /^ol_variant_[a-f0-9]+$/;
const VARIANT_ID_MESSAGE = 'must be an OpenLinker internal variant id (ol_variant_{hex})';

export class PublishPriceDto {
  @ApiProperty({ example: 199.0 })
  @IsNumber()
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: 'PLN' })
  @IsString()
  @IsNotEmpty()
  currency!: string;
}

export class PublishContentDto {
  @ApiPropertyOptional({ description: 'Product title (overrides master product name).' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Product description. `null` ⇒ no override.',
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Short/excerpt description. `null` ⇒ no override.',
  })
  @IsOptional()
  @IsString()
  shortDescription?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    isArray: true,
    type: String,
    description: 'Marketing tags. `null` ⇒ no override.',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsArray()
  @IsString({ each: true })
  tags?: string[] | null;

  @ApiPropertyOptional({
    nullable: true,
    isArray: true,
    type: String,
    description: 'Image URLs in display order. `null` ⇒ no override.',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsArray()
  @IsUrl({}, { each: true, message: 'imageUrls must be an array of valid URLs' })
  imageUrls?: string[] | null;
}

export class PublishDimensionsDto {
  @ApiPropertyOptional({ example: 12.5, minimum: 0, description: 'Length. Omitted ⇒ unset.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  length?: number;

  @ApiPropertyOptional({ example: 8, minimum: 0, description: 'Width. Omitted ⇒ unset.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  width?: number;

  @ApiPropertyOptional({ example: 3, minimum: 0, description: 'Height. Omitted ⇒ unset.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  height?: number;
}

export class PublishCommerceDto {
  @ApiPropertyOptional({
    type: PublishPriceDto,
    description: 'Discounted sale price. Omitted ⇒ no sale price set.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PublishPriceDto)
  salePrice?: PublishPriceDto;

  @ApiPropertyOptional({
    description: 'ISO 8601 datetime the sale price becomes active.',
    example: '2026-08-01T00:00:00Z',
  })
  @IsOptional()
  @IsISO8601()
  saleStartsAt?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 datetime the sale price expires.',
    example: '2026-08-31T23:59:59Z',
  })
  @IsOptional()
  @IsISO8601()
  saleEndsAt?: string;

  @ApiPropertyOptional({ type: PublishDimensionsDto, description: 'Physical dimensions.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PublishDimensionsDto)
  dimensions?: PublishDimensionsDto;

  @ApiPropertyOptional({
    description: 'Tax class slug (shop-defined, e.g. "reduced-rate"). Omitted ⇒ shop default.',
  })
  @IsOptional()
  @IsString()
  taxClass?: string;

  @ApiPropertyOptional({ enum: PublishTaxStatusValues, description: 'Tax treatment.' })
  @IsOptional()
  @IsIn(PublishTaxStatusValues)
  taxStatus?: PublishTaxStatus;
}

export class PublishProductRequestDto {
  @ApiProperty({
    description: 'OpenLinker internal variant id',
    example: 'ol_variant_a1b2c3d4e5f6',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(VARIANT_ID_PATTERN, { message: `internalVariantId ${VARIANT_ID_MESSAGE}` })
  internalVariantId!: string;

  @ApiProperty({ enum: PublishProductStatusValues, example: 'published' })
  @IsIn(PublishProductStatusValues)
  status!: PublishProductStatus;

  @ApiProperty({ example: 7, minimum: 0 })
  @IsInt()
  @Min(0)
  stock!: number;

  @ApiPropertyOptional({
    type: PublishPriceDto,
    description: 'Price override; omitted ⇒ master price.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PublishPriceDto)
  price?: PublishPriceDto;

  @ApiPropertyOptional({ type: PublishContentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PublishContentDto)
  content?: PublishContentDto;

  @ApiPropertyOptional({
    type: PublishCommerceDto,
    description: 'Operator-supplied commerce fields (sale price, dimensions, tax).',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PublishCommerceDto)
  commerce?: PublishCommerceDto;
}

export class BulkPublishItemDto {
  @ApiProperty({
    description: 'OpenLinker internal variant id',
    example: 'ol_variant_a1b2c3d4e5f6',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(VARIANT_ID_PATTERN, { message: `internalVariantId ${VARIANT_ID_MESSAGE}` })
  internalVariantId!: string;

  @ApiProperty({ example: 7, minimum: 0, description: "This product's own stock." })
  @IsInt()
  @Min(0)
  stock!: number;

  @ApiPropertyOptional({
    type: PublishPriceDto,
    description: "This product's own price override; omitted ⇒ master price.",
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PublishPriceDto)
  price?: PublishPriceDto;
}

export class BulkPublishProductRequestDto {
  @ApiProperty({ description: 'Target shop connection id (uuid).' })
  @IsString()
  @IsNotEmpty()
  connectionId!: string;

  @ApiProperty({
    isArray: true,
    type: BulkPublishItemDto,
    description: 'One entry per product (1..100), each with its own stock/price.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BulkPublishItemDto)
  items!: BulkPublishItemDto[];

  @ApiProperty({ enum: PublishProductStatusValues, example: 'published' })
  @IsIn(PublishProductStatusValues)
  status!: PublishProductStatus;

  @ApiPropertyOptional({ type: PublishContentDto, description: 'Shared content overrides.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PublishContentDto)
  content?: PublishContentDto;

  @ApiPropertyOptional({
    type: PublishCommerceDto,
    description: 'Shared commerce fields (sale price, dimensions, tax) applied to every child.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PublishCommerceDto)
  commerce?: PublishCommerceDto;
}
