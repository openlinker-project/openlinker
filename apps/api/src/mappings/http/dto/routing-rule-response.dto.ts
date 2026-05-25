/**
 * Routing Rule Response DTO
 *
 * Wire shape for a persisted fulfillment-routing rule (#836).
 *
 * @module apps/api/src/mappings/http/dto
 */

import { ApiProperty } from '@nestjs/swagger';
import {
  FulfillmentProcessorKindValues,
  type FulfillmentProcessorKind,
  type FulfillmentRoutingRule,
} from '@openlinker/core/mappings';

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

  static fromDomain(rule: FulfillmentRoutingRule): RoutingRuleResponseDto {
    const dto = new RoutingRuleResponseDto();
    dto.id = rule.id;
    dto.sourceConnectionId = rule.sourceConnectionId;
    dto.sourceDeliveryMethodId = rule.sourceDeliveryMethodId;
    dto.processorKind = rule.processorKind;
    dto.processorConnectionId = rule.processorConnectionId;
    return dto;
  }
}
