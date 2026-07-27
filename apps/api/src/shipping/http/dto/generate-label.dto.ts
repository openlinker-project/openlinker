/**
 * Generate Label DTO
 *
 * Request body for POST /shipments/generate-label. A 1:1 reshape of the core
 * `ShipmentDispatchInput` (#835) — routing keys (`sourceConnectionId`,
 * `sourceDeliveryMethodId`) plus the caller-supplied label payload
 * (`shippingMethod`, `paczkomatId?`, `recipient`, `parcel`). The dispatch seam
 * fills `shipmentId` (after creating the row) and `connectionId` (from the
 * resolved processor) itself, so they're absent here.
 *
 * @module apps/api/src/shipping/http/dto
 */
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ShippingMethodValues,
  type ShippingMethod,
  DeliveryIntentValues,
  type DeliveryIntent,
} from '@openlinker/core/shipping';

class ShipmentAddressDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  street!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  buildingNumber!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  city!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  postCode!: string;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2 (e.g. PL)' })
  @IsString()
  @IsNotEmpty()
  countryCode!: string;
}

class ShipmentRecipientDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ApiPropertyOptional({ type: ShipmentAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShipmentAddressDto)
  address?: ShipmentAddressDto;
}

class ShipmentDimensionsDto {
  @ApiProperty({ description: 'Millimetres' })
  @IsInt()
  @Min(1)
  length!: number;

  @ApiProperty({ description: 'Millimetres' })
  @IsInt()
  @Min(1)
  width!: number;

  @ApiProperty({ description: 'Millimetres' })
  @IsInt()
  @Min(1)
  height!: number;
}

class ShipmentParcelDto {
  @ApiPropertyOptional({ description: 'Carrier size code for locker shipments' })
  @IsOptional()
  @IsString()
  template?: string;

  @ApiPropertyOptional({ type: ShipmentDimensionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShipmentDimensionsDto)
  dimensions?: ShipmentDimensionsDto;

  @ApiPropertyOptional({ description: 'Weight in grams (courier shipments)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  weightGrams?: number;
}

class ShipmentCodDto {
  @ApiProperty({ description: 'Cash-on-delivery amount to collect, as a decimal string (e.g. "129.90")' })
  @IsString()
  @IsNotEmpty()
  // Defense-in-depth: the FE already gates the decimal shape, but the API has
  // other potential clients — reject a malformed amount here so it never reaches
  // the carrier (#966 review).
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'COD amount must be a decimal string, e.g. "129.90"' })
  amount!: string;

  @ApiProperty({ description: 'ISO 4217 currency code (e.g. PLN). Carrier validates the supported set.' })
  @IsString()
  @IsNotEmpty()
  currency!: string;
}

class ShipmentInsuredValueDto {
  @ApiProperty({ description: 'Declared value to insure, as a decimal string (e.g. "150.00")' })
  @IsString()
  @IsNotEmpty()
  // Defense-in-depth: the FE gates the decimal shape, but the API has other
  // potential clients — reject a malformed amount here so it never reaches the
  // carrier (mirrors ShipmentCodDto, #1542).
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'Insured amount must be a decimal string, e.g. "150.00"' })
  amount!: string;

  @ApiProperty({ description: 'ISO 4217 currency code (e.g. PLN). Carrier validates the supported set.' })
  @IsString()
  @IsNotEmpty()
  currency!: string;
}

export class GenerateLabelDto {
  @ApiProperty({ description: 'Order-source connection id (the routing rule scope)' })
  @IsUUID()
  sourceConnectionId!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Source-side delivery method id; null resolves to the omp_fulfilled default',
  })
  @IsOptional()
  @IsString()
  sourceDeliveryMethodId?: string | null;

  @ApiProperty({ description: 'Internal order id (ol_order_*)' })
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  @ApiPropertyOptional({
    enum: DeliveryIntentValues,
    description:
      'Carrier-neutral delivery intent (#979, ADR-020). The dispatch seam resolves ' +
      'the carrier-specific shipping method from this. Preferred over `shippingMethod`.',
  })
  @IsOptional()
  @IsEnum(DeliveryIntentValues)
  deliveryIntent?: DeliveryIntent;

  @ApiPropertyOptional({
    enum: ShippingMethodValues,
    deprecated: true,
    description:
      '@deprecated — send `deliveryIntent` instead. Accepted for one release as a ' +
      'fallback when `deliveryIntent` is absent (the seam derives the intent from it).',
  })
  @IsOptional()
  @IsEnum(ShippingMethodValues)
  shippingMethod?: ShippingMethod;

  @ApiPropertyOptional({
    description:
      'Pickup-point id — required for point-delivery methods (paczkomat = locker, pickup = parcel-shop/PUDO); absent for kurier',
  })
  @IsOptional()
  @IsString()
  paczkomatId?: string;

  @ApiProperty({ type: ShipmentRecipientDto })
  // `@ValidateNested()` does not reject an absent value; `@IsDefined()` +
  // `@IsObject()` make the required field a clean 400 on omission instead of a
  // downstream TypeError in the adapter (#1518).
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ShipmentRecipientDto)
  recipient!: ShipmentRecipientDto;

  @ApiProperty({ type: ShipmentParcelDto })
  // See `recipient` above — a required nested object needs @IsDefined()/@IsObject()
  // for `@ValidateNested()` to fail on an omitted `parcel` (#1518).
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ShipmentParcelDto)
  parcel!: ShipmentParcelDto;

  @ApiPropertyOptional({
    type: ShipmentCodDto,
    description:
      'Cash-on-delivery to collect on delivery (operator-supplied, #966). COD-incapable carriers ignore it; DPD Polska translates it to the COD service.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShipmentCodDto)
  cod?: ShipmentCodDto;

  @ApiPropertyOptional({
    type: ShipmentInsuredValueDto,
    description:
      'Declared value to insure the parcel for (operator-supplied, #1542). ' +
      'Insurance-incapable carriers ignore it; InPost ShipX translates it to its `insurance` object.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShipmentInsuredValueDto)
  insuredValue?: ShipmentInsuredValueDto;
}
