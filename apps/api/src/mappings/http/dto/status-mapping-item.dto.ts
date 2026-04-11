/**
 * Status Mapping Item DTO
 *
 * Single status mapping item used in upsert requests.
 *
 * @module apps/api/src/mappings/http/dto
 */

import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class StatusMappingItemDto {
  @ApiProperty({ description: 'Allegro order status value', example: 'READY_FOR_PROCESSING' })
  @IsString()
  @IsNotEmpty()
  allegroStatus!: string;

  @ApiProperty({ description: 'PrestaShop order status ID', example: '2' })
  @IsString()
  @IsNotEmpty()
  prestashopStatusId!: string;
}
