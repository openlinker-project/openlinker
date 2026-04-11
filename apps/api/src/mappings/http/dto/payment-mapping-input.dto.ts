/**
 * Payment Mapping Input DTO
 *
 * Single payment mapping item used in upsert requests.
 *
 * @module apps/api/src/mappings/http/dto
 */

import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PaymentMappingInputDto {
  @ApiProperty({ description: 'Allegro payment provider name', example: 'P24' })
  @IsString()
  @IsNotEmpty()
  allegroPaymentProvider!: string;

  @ApiProperty({ description: 'PrestaShop payment module name', example: 'ps_wirepayment' })
  @IsString()
  @IsNotEmpty()
  prestashopPaymentModule!: string;
}
