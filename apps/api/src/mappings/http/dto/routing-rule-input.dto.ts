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

import { IsIn, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  FulfillmentProcessorKindValues,
  type FulfillmentProcessorKind,
} from '@openlinker/core/mappings';

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
}
