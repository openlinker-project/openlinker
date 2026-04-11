/**
 * Upsert Carrier Mappings DTO
 *
 * @module apps/api/src/mappings/http/dto
 */

import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CarrierMappingInputDto } from './carrier-mapping-input.dto';

export class UpsertCarrierMappingsDto {
  @ApiProperty({ type: [CarrierMappingInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CarrierMappingInputDto)
  items!: CarrierMappingInputDto[];
}
