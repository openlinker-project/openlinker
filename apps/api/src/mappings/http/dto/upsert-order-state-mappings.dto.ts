/**
 * Upsert Order State Mappings DTO
 *
 * @module apps/api/src/mappings/http/dto
 */

import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { OrderStateMappingInputDto } from './order-state-mapping-input.dto';

export class UpsertOrderStateMappingsDto {
  @ApiProperty({ type: [OrderStateMappingInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderStateMappingInputDto)
  items!: OrderStateMappingInputDto[];
}
