/**
 * Candidate Processor Response DTO
 *
 * A processor option the operator may route a delivery method to (#836).
 * IDs + kind only — the FE resolves the connection's display name
 * (ConnectionEntityLabel) and maps the kind to a label client-side.
 *
 * @module apps/api/src/mappings/http/dto
 */

import { ApiProperty } from '@nestjs/swagger';
import {
  FulfillmentProcessorKindValues,
  type CandidateProcessor,
  type FulfillmentProcessorKind,
} from '@openlinker/core/mappings';

export class CandidateProcessorResponseDto {
  @ApiProperty({ enum: FulfillmentProcessorKindValues })
  processorKind!: FulfillmentProcessorKind;

  @ApiProperty()
  processorConnectionId!: string;

  static fromDomain(candidate: CandidateProcessor): CandidateProcessorResponseDto {
    const dto = new CandidateProcessorResponseDto();
    dto.processorKind = candidate.processorKind;
    dto.processorConnectionId = candidate.processorConnectionId;
    return dto;
  }
}
