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
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShippingMethodValues, type ShippingMethod } from '@openlinker/core/shipping';

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

  @ApiProperty({ enum: ShippingMethodValues })
  @IsEnum(ShippingMethodValues)
  shippingMethod!: ShippingMethod;

  @ApiPropertyOptional({ description: 'Required when shippingMethod === paczkomat' })
  @IsOptional()
  @IsString()
  paczkomatId?: string;

  @ApiProperty({ type: ShipmentRecipientDto })
  @ValidateNested()
  @Type(() => ShipmentRecipientDto)
  recipient!: ShipmentRecipientDto;

  @ApiProperty({ type: ShipmentParcelDto })
  @ValidateNested()
  @Type(() => ShipmentParcelDto)
  parcel!: ShipmentParcelDto;
}
