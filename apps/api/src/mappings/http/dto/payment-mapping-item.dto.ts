/**
 * Payment Mapping Item DTO
 *
 * @module apps/api/src/mappings/http/dto
 */

import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PaymentMappingItemDto {
  @ApiProperty({ description: 'Allegro payment provider name', example: 'P24' })
  @IsString()
  @IsNotEmpty()
  allegroPaymentProvider!: string;

  @ApiProperty({ description: 'PrestaShop payment module name', example: 'ps_wirepayment' })
  @IsString()
  @IsNotEmpty()
  prestashopPaymentModule!: string;
}
