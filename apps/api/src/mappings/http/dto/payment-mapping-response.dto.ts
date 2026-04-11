/**
 * Payment Mapping Response DTO
 *
 * @module apps/api/src/mappings/http/dto
 */

import { ApiProperty } from '@nestjs/swagger';
import { PaymentMapping } from '@openlinker/core/mappings';

export class PaymentMappingResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  connectionId!: string;

  @ApiProperty()
  allegroPaymentProvider!: string;

  @ApiProperty()
  prestashopPaymentModule!: string;

  static fromDomain(m: PaymentMapping): PaymentMappingResponseDto {
    const dto = new PaymentMappingResponseDto();
    dto.id = m.id;
    dto.connectionId = m.connectionId;
    dto.allegroPaymentProvider = m.allegroPaymentProvider;
    dto.prestashopPaymentModule = m.prestashopPaymentModule;
    return dto;
  }
}
