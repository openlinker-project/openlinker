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
  IsDefined,
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
  registerDecorator,
  ValidateIf,
  ValidateNested,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Property validator: the decorated ISO-8601 datetime must be strictly after the
 * sibling datetime named by `property`. Passes when either side is absent
 * (presence is enforced separately) or unparseable (format is `@IsISO8601`'s job).
 */
function IsAfter(property: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isAfter',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const [relatedProperty] = args.constraints as [string];
          const related = (args.object as Record<string, unknown>)[relatedProperty];
          if (typeof value !== 'string' || typeof related !== 'string') return true;
          const end = Date.parse(value);
          const start = Date.parse(related);
          if (Number.isNaN(end) || Number.isNaN(start)) return true;
          return end > start;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be after ${args.constraints[0]}`;
        },
      },
    });
  };
}

import {
  PublishProductStatusValues,
  PublishTaxStatusValues,
  type PublishProductStatus,
  type PublishTaxStatus,
} from '@openlinker/core/listings';

import { OfferParameterDto } from './create-offer.dto';

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
    description:
      'Discounted sale price. Required when a sale window (saleStartsAt/saleEndsAt) is supplied; omitted ⇒ no sale price set.',
  })
  // Validated when a sale price OR a sale window is supplied; `@IsDefined` then
  // enforces that a window can't be scheduled without a price to discount to.
  @ValidateIf((o: PublishCommerceDto) => o.saleStartsAt != null || o.saleEndsAt != null || o.salePrice != null)
  @IsDefined({
    message: 'salePrice is required when a sale window (saleStartsAt/saleEndsAt) is supplied',
  })
  @ValidateNested()
  @Type(() => PublishPriceDto)
  salePrice?: PublishPriceDto;

  @ApiPropertyOptional({
    description: 'ISO 8601 datetime the sale price becomes active (UTC).',
    example: '2026-08-01T00:00:00Z',
  })
  @IsOptional()
  @IsISO8601()
  saleStartsAt?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 datetime the sale price expires (UTC). Must be after saleStartsAt.',
    example: '2026-08-31T23:59:59Z',
  })
  @IsOptional()
  @IsISO8601()
  @IsAfter('saleStartsAt', { message: 'saleEndsAt must be after saleStartsAt' })
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

  @ApiPropertyOptional({
    type: PublishContentDto,
    description:
      "This product's own content override (#1831); wins over the batch-shared content. Omitted ⇒ batch-shared content applies.",
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PublishContentDto)
  content?: PublishContentDto;

  @ApiPropertyOptional({
    isArray: true,
    type: String,
    description:
      "This product's own destination category ids (#1831). Present (including empty) ⇒ skips server-side provisioning; omitted ⇒ builder provisions as today.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  destinationCategoryIds?: string[];

  @ApiPropertyOptional({
    isArray: true,
    type: OfferParameterDto,
    description:
      "This product's own neutral category parameters (#1831). Present (including empty) ⇒ skips attribute projection; omitted ⇒ builder projects as today.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OfferParameterDto)
  parameters?: OfferParameterDto[];
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
