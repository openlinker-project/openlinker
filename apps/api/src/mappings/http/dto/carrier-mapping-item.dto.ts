/**
 * Carrier Mapping Item DTO
 *
 * @module apps/api/src/mappings/http/dto
 */

import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CarrierMappingItemDto {
  @ApiProperty({ description: 'Allegro delivery method ID', example: 'INPOST_PACZKOMAT' })
  @IsString()
  @IsNotEmpty()
  allegroDeliveryMethodId!: string;

  @ApiProperty({ description: 'PrestaShop carrier ID', example: '2' })
  @IsString()
  @IsNotEmpty()
  prestashopCarrierId!: string;
}
