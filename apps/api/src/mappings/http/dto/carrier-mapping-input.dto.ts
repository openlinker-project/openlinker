/**
 * Carrier Mapping Input DTO
 *
 * Single carrier mapping item used in upsert requests.
 *
 * @module apps/api/src/mappings/http/dto
 */

import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CarrierMappingInputDto {
  @ApiProperty({ description: 'Allegro delivery method ID', example: 'INPOST_PACZKOMAT' })
  @IsString()
  @IsNotEmpty()
  allegroDeliveryMethodId!: string;

  @ApiProperty({ description: 'PrestaShop carrier ID', example: '2' })
  @IsString()
  @IsNotEmpty()
  prestashopCarrierId!: string;
}
