/**
 * Upsert Status Mappings DTO
 *
 * Request body for PUT /connections/:connectionId/mappings/status.
 * Replaces all status mappings for the given connection.
 *
 * @module apps/api/src/mappings/http/dto
 */

import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { StatusMappingItemDto } from './status-mapping-item.dto';

export class UpsertStatusMappingsDto {
  @ApiProperty({ type: [StatusMappingItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatusMappingItemDto)
  items!: StatusMappingItemDto[];
}
