/**
 * Upsert Carrier Mappings DTO
 *
 * @module apps/api/src/mappings/http/dto
 */

import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CarrierMappingItemDto } from './carrier-mapping-item.dto';

export class UpsertCarrierMappingsDto {
  @ApiProperty({ type: [CarrierMappingItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CarrierMappingItemDto)
  items!: CarrierMappingItemDto[];
}
