/**
 * Order State Mapping Input DTO
 *
 * Single OL-status → destination-state override item used in upsert requests
 * (#862). `olStatus` is constrained to the canonical OrderStatus union;
 * `externalStateId` is the destination platform's native state id as a string
 * (PrestaShop: numeric order-state id).
 *
 * @module apps/api/src/mappings/http/dto
 */

import { IsString, IsNotEmpty, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OrderStatusValues, type OrderStatus } from '@openlinker/core/orders';

export class OrderStateMappingInputDto {
  @ApiProperty({ enum: OrderStatusValues, description: 'OpenLinker order status', example: 'shipped' })
  @IsIn(OrderStatusValues)
  olStatus!: OrderStatus;

  @ApiProperty({ description: 'Destination order-state id (PrestaShop: numeric)', example: '4' })
  @IsString()
  @IsNotEmpty()
  externalStateId!: string;
}
