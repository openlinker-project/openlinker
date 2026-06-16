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

import { PublishProductStatusValues, type PublishProductStatus } from '@openlinker/core/listings';

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
}

export class BulkPublishProductRequestDto {
  @ApiProperty({ description: 'Target shop connection id (uuid).' })
  @IsString()
  @IsNotEmpty()
  connectionId!: string;

  @ApiProperty({ isArray: true, type: String, description: 'Internal variant ids (1..100).' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Matches(VARIANT_ID_PATTERN, { each: true, message: `internalVariantIds ${VARIANT_ID_MESSAGE}` })
  internalVariantIds!: string[];

  @ApiProperty({ enum: PublishProductStatusValues, example: 'published' })
  @IsIn(PublishProductStatusValues)
  status!: PublishProductStatus;

  @ApiProperty({ example: 7, minimum: 0, description: 'Shared stock applied to every variant.' })
  @IsInt()
  @Min(0)
  stock!: number;

  @ApiPropertyOptional({ type: PublishPriceDto, description: 'Shared price override.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PublishPriceDto)
  price?: PublishPriceDto;

  @ApiPropertyOptional({ type: PublishContentDto, description: 'Shared content overrides.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PublishContentDto)
  content?: PublishContentDto;
}
