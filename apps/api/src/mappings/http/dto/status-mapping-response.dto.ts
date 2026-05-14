/**
 * Status Mapping Response DTO
 *
 * Response shape for status mapping endpoints.
 *
 * @module apps/api/src/mappings/http/dto
 */

import { ApiProperty } from '@nestjs/swagger';
import type { StatusMapping } from '@openlinker/core/mappings';

export class StatusMappingResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  connectionId!: string;

  @ApiProperty()
  allegroStatus!: string;

  @ApiProperty()
  prestashopStatusId!: string;

  static fromDomain(m: StatusMapping): StatusMappingResponseDto {
    const dto = new StatusMappingResponseDto();
    dto.id = m.id;
    dto.connectionId = m.connectionId;
    dto.allegroStatus = m.allegroStatus;
    dto.prestashopStatusId = m.prestashopStatusId;
    return dto;
  }
}
