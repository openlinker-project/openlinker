/**
 * Bundle product creation DTOs (#3935)
 *
 * @module apps/api/src/products/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductCreationModeValues, type ProductCreationMode } from '@openlinker/core/products';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class BundleCreationTargetResponseDto {
  @ApiProperty() connectionId!: string;
  @ApiProperty() connectionName!: string;
  @ApiProperty() platformType!: string;
  @ApiProperty({
    enum: ProductCreationModeValues,
    nullable: true,
    description: 'Null when this master cannot create products from OpenLinker',
  })
  creationMode!: ProductCreationMode | null;
}

export class CreateBundleProductRequestDto {
  @ApiProperty({ description: 'The product master connection the product is created in' })
  @IsString()
  @IsNotEmpty()
  connectionId!: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) name!: string;

  @ApiProperty({ description: 'Also the idempotency key: a retry with the same SKU adopts the first product' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  sku!: string;

  @ApiProperty({ description: 'Gross price of the whole set' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  price!: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) ean?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20000) description?: string;

  @ApiPropertyOptional({ description: 'A component variant whose tax rate the price includes' })
  @IsOptional()
  @IsString()
  rateSourceVariantId?: string;
}

export class CreatedBundleProductResponseDto {
  @ApiProperty() productId!: string;
  @ApiProperty() variantId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() adopted!: boolean;
}
