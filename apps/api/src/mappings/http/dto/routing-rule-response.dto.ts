/**
 * Routing Rule Response DTO
 *
 * Wire shape for a persisted fulfillment-routing rule (#836).
 *
 * @module apps/api/src/mappings/http/dto
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  FulfillmentProcessorKindValues,
  type FulfillmentParcelProfile,
  type FulfillmentProcessorKind,
  type FulfillmentRoutingRule,
} from '@openlinker/core/mappings';

export class ParcelProfileResponseDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  parcelTemplate!: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  lengthMm!: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  widthMm!: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  heightMm!: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  defaultWeightGrams!: number | null;

  static fromDomain(profile: FulfillmentParcelProfile): ParcelProfileResponseDto {
    const dto = new ParcelProfileResponseDto();
    dto.parcelTemplate = profile.parcelTemplate;
    dto.lengthMm = profile.lengthMm;
    dto.widthMm = profile.widthMm;
    dto.heightMm = profile.heightMm;
    dto.defaultWeightGrams = profile.defaultWeightGrams;
    return dto;
  }
}

export class RoutingRuleResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  sourceConnectionId!: string;

  @ApiProperty()
  sourceDeliveryMethodId!: string;

  @ApiProperty({ enum: FulfillmentProcessorKindValues })
  processorKind!: FulfillmentProcessorKind;

  @ApiProperty()
  processorConnectionId!: string;

  @ApiProperty({ type: ParcelProfileResponseDto, nullable: true })
  parcelProfile!: ParcelProfileResponseDto | null;

  static fromDomain(rule: FulfillmentRoutingRule): RoutingRuleResponseDto {
    const dto = new RoutingRuleResponseDto();
    dto.id = rule.id;
    dto.sourceConnectionId = rule.sourceConnectionId;
    dto.sourceDeliveryMethodId = rule.sourceDeliveryMethodId;
    dto.processorKind = rule.processorKind;
    dto.processorConnectionId = rule.processorConnectionId;
    dto.parcelProfile = rule.parcelProfile
      ? ParcelProfileResponseDto.fromDomain(rule.parcelProfile)
      : null;
    return dto;
  }
}
