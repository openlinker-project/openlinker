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
import { StatusMappingInputDto } from './status-mapping-input.dto';

export class UpsertStatusMappingsDto {
  @ApiProperty({ type: [StatusMappingInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatusMappingInputDto)
  items!: StatusMappingInputDto[];
}
