/**
 * Carrier Mapping Response DTO
 *
 * @module apps/api/src/mappings/http/dto
 */

import { ApiProperty } from '@nestjs/swagger';
import { CarrierMapping } from '@openlinker/core/mappings';

export class CarrierMappingResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  connectionId!: string;

  @ApiProperty()
  allegroDeliveryMethodId!: string;

  @ApiProperty()
  prestashopCarrierId!: string;

  static fromDomain(m: CarrierMapping): CarrierMappingResponseDto {
    const dto = new CarrierMappingResponseDto();
    dto.id = m.id;
    dto.connectionId = m.connectionId;
    dto.allegroDeliveryMethodId = m.allegroDeliveryMethodId;
    dto.prestashopCarrierId = m.prestashopCarrierId;
    return dto;
  }
}
