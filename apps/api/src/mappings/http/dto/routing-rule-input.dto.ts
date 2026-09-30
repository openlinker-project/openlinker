/**
 * Routing Rule Input DTO
 *
 * Single fulfillment-routing rule item used in replace (PUT) requests (#836).
 * "Default / PrestaShop-fulfilled" methods are represented by rule ABSENCE —
 * the FE submits only diverted methods, so every item here names an explicit
 * processor. Mirrors the carrier-mapping input-DTO shape.
 *
 * @module apps/api/src/mappings/http/dto
 */

import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  FulfillmentProcessorKindValues,
  PARCEL_PROFILE_BOUNDS,
  type FulfillmentProcessorKind,
} from '@openlinker/core/mappings';

/**
 * Optional parcel profile of a routing rule (#3651). Every field is optional
 * and nullable ("not set"); integers must be positive. Length/width/height
 * must be supplied together - enforced by the service, not here, because that
 * is a cross-field rule.
 */
export class ParcelProfileInputDto {
  @ApiPropertyOptional({ nullable: true, description: 'Carrier size code, e.g. a locker size' })
  @IsOptional()
  @IsString()
  @MaxLength(PARCEL_PROFILE_BOUNDS.parcelTemplateMaxLength)
  parcelTemplate?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Box length in millimetres' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PARCEL_PROFILE_BOUNDS.dimensionMmMax)
  lengthMm?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Box width in millimetres' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PARCEL_PROFILE_BOUNDS.dimensionMmMax)
  widthMm?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Box height in millimetres' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PARCEL_PROFILE_BOUNDS.dimensionMmMax)
  heightMm?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Per-unit fallback weight in grams for variants that carry none',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PARCEL_PROFILE_BOUNDS.defaultWeightGramsMax)
  defaultWeightGrams?: number | null;
}

export class RoutingRuleInputDto {
  @ApiProperty({
    description: 'Source delivery method id (e.g. an Allegro delivery.method.id)',
    example: '2488f7b7-5d1c-4d65-b85c-4cbcf253fd93',
  })
  @IsString()
  @IsNotEmpty()
  sourceDeliveryMethodId!: string;

  @ApiProperty({ enum: FulfillmentProcessorKindValues })
  @IsIn([...FulfillmentProcessorKindValues])
  processorKind!: FulfillmentProcessorKind;

  @ApiProperty({ description: 'The connection that fulfils this method' })
  @IsString()
  @IsNotEmpty()
  processorConnectionId!: string;

  @ApiPropertyOptional({ type: ParcelProfileInputDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ParcelProfileInputDto)
  parcelProfile?: ParcelProfileInputDto | null;
}
