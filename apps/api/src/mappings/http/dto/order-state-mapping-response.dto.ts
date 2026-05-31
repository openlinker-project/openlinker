/**
 * Order State Mapping Response DTO
 *
 * @module apps/api/src/mappings/http/dto
 */

import { ApiProperty } from '@nestjs/swagger';
import { OrderStatusValues, type OrderStatus } from '@openlinker/core/orders';
import type { OrderStateMapping } from '@openlinker/core/mappings';

export class OrderStateMappingResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  connectionId!: string;

  @ApiProperty({ enum: OrderStatusValues })
  olStatus!: OrderStatus;

  @ApiProperty()
  externalStateId!: string;

  static fromDomain(m: OrderStateMapping): OrderStateMappingResponseDto {
    const dto = new OrderStateMappingResponseDto();
    dto.id = m.id;
    dto.connectionId = m.connectionId;
    dto.olStatus = m.olStatus;
    dto.externalStateId = m.externalStateId;
    return dto;
  }
}
