/**
 * Bundle Definition DTOs (#3607, ADR-083)
 *
 * @module apps/api/src/products/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { BundleGiftSlotFormValues, type BundleGiftDocumentForm } from '@openlinker/core/products';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export const BUNDLE_MAX_COMPONENTS = 50;

export class BundleComponentRequestDto {
  @ApiProperty({ description: 'Master variant id of the component' })
  @IsString()
  @IsNotEmpty()
  variantId!: string;

  @ApiProperty({ description: 'Units of this component in ONE bundle unit', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ description: 'This component is the free gift of the set' })
  @IsOptional()
  @IsBoolean()
  giftSlot?: boolean;

  @ApiPropertyOptional({
    enum: BundleGiftSlotFormValues,
    description: 'How a sales document shows the gift slot. Only with `giftSlot`; absent means "as in settings".',
  })
  @IsOptional()
  @IsIn(BundleGiftSlotFormValues as readonly string[])
  documentForm?: BundleGiftDocumentForm;
}

export class CreateBundleDefinitionRequestDto {
  @ApiProperty({ description: 'The bundle\'s own master variant id' })
  @IsString()
  @IsNotEmpty()
  variantId!: string;

  @ApiProperty({ type: [BundleComponentRequestDto], minItems: 1, maxItems: BUNDLE_MAX_COMPONENTS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BUNDLE_MAX_COMPONENTS)
  @ValidateNested({ each: true })
  @Type(() => BundleComponentRequestDto)
  components!: BundleComponentRequestDto[];
}

export class UpdateBundleDefinitionRequestDto {
  @ApiProperty({ type: [BundleComponentRequestDto], minItems: 1, maxItems: BUNDLE_MAX_COMPONENTS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BUNDLE_MAX_COMPONENTS)
  @ValidateNested({ each: true })
  @Type(() => BundleComponentRequestDto)
  components!: BundleComponentRequestDto[];
}

export class BundleComponentResponseDto {
  @ApiProperty() variantId!: string;
  @ApiProperty() productId!: string;
  @ApiProperty() quantity!: number;
  @ApiPropertyOptional() giftSlot?: boolean;
  @ApiPropertyOptional({ enum: BundleGiftSlotFormValues }) documentForm?: BundleGiftDocumentForm;
}

export class BundleDefinitionResponseDto {
  @ApiProperty() variantId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: [BundleComponentResponseDto] }) components!: BundleComponentResponseDto[];
}

export class BundleCreatedResponseDto extends BundleDefinitionResponseDto {
  @ApiProperty({
    description:
      'Orders that were waiting for a bundle (a multipack with no definition) and were sent to be ingested again now (#3624)',
  })
  releasedOrders!: number;
}

export class ConfirmMultipackRequestDto {
  @ApiProperty({ description: 'The master variant the offer maps to' })
  @IsString()
  @IsNotEmpty()
  variantId!: string;

  @ApiProperty({ description: 'Units of the variant in ONE sold unit', minimum: 2 })
  @IsInt()
  @Min(2)
  packQuantity!: number;
}

export class MultipackConfirmedResponseDto {
  @ApiProperty() variantId!: string;
  @ApiProperty() packQuantity!: number;
  @ApiProperty({ description: 'Held orders sent to be processed again now' })
  releasedOrders!: number;
}

export class BundleProductSummaryDto {
  @ApiPropertyOptional({ type: String, nullable: true }) name!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) sku!: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Gross catalogue price' })
  price!: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) currency!: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Authenticated API path of the product picture (fetch with the bearer token); null when the product has none',
  })
  imageUrl!: string | null;
}

export class BundleUsedInResponseDto {
  @ApiProperty({ description: 'The bundle that holds the product as a component' })
  bundleVariantId!: string;
  @ApiPropertyOptional({ description: 'The component variant this row is about (batched read)' })
  componentVariantId?: string;
  @ApiProperty({ description: 'Units of the product in ONE bundle unit' })
  quantity!: number;
  @ApiPropertyOptional() giftSlot?: boolean;
  @ApiProperty({ type: BundleProductSummaryDto })
  bundle!: BundleProductSummaryDto;
}

export class BundleHistoryEntryResponseDto extends BundleDefinitionResponseDto {
  @ApiProperty({ description: 'True for the version that is in force now' })
  current!: boolean;

  @ApiProperty({ description: 'When this version was written (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({
    description: 'Open orders that were frozen with exactly this composition (nothing shipped yet)',
  })
  openOrders!: number;

  @ApiProperty({ type: [BundleProductSummaryDto], description: 'Component names, in component order' })
  componentSummaries!: BundleProductSummaryDto[];
}

export class BundleComponentAvailabilityResponseDto extends BundleComponentResponseDto {
  @ApiProperty({ type: BundleProductSummaryDto })
  summary!: BundleProductSummaryDto;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Units OpenLinker will promise for the component; null = unknown, never zero',
  })
  availableToPromise!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Whole bundles this component alone can supply: floor(available / quantity)',
  })
  bundlesSupported!: number | null;
}

export class BundleMasterDto {
  @ApiProperty() connectionId!: string;
  @ApiProperty() connectionName!: string;
}

export class MasterBundleComponentPreviewDto {
  @ApiProperty() variantId!: string;
  @ApiProperty() productId!: string;
  @ApiProperty() quantity!: number;
}

export class MasterBundleCompositionResponseDto {
  @ApiProperty() connectionId!: string;
  @ApiProperty({ type: [MasterBundleComponentPreviewDto] })
  components!: MasterBundleComponentPreviewDto[];
}

export class BundleWithAvailabilityResponseDto extends BundleDefinitionResponseDto {
  @ApiProperty({ type: String, nullable: true, description: 'The product the bundle variant belongs to' })
  productId!: string | null;

  @ApiProperty({
    type: BundleMasterDto,
    nullable: true,
    description:
      'The product master that can read this bundle\'s composition, or null when none can (#3932). Gates the sync action.',
  })
  composedByMaster!: BundleMasterDto | null;

  @ApiProperty({ type: BundleProductSummaryDto })
  bundle!: BundleProductSummaryDto;

  @ApiProperty({
    description:
      'Open orders still holding an OLDER composition of this bundle; they ship the way they were frozen (#3624)',
  })
  openOrdersOnOlderComposition!: number;

  @ApiProperty({ type: [BundleComponentAvailabilityResponseDto] })
  componentAvailability!: BundleComponentAvailabilityResponseDto[];

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'The fewest bundles any component supports; null when any component is unknown. Not published to channels (#3931).',
  })
  bundlesAvailable!: number | null;
}
