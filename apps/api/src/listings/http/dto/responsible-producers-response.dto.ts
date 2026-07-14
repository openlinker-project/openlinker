/**
 * Responsible Producers Response DTO (#1531)
 *
 * Response shape for `GET /listings/connections/:connectionId/responsible-producers`.
 * Swagger-decorated mirror of `ResponsibleProducerEntry[]` from
 * `@openlinker/core/listings`, wrapped under `responsibleProducers`.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

import {
  ResponsibleProducerKindValues,
  type ResponsibleProducerKind,
} from '@openlinker/core/listings';

export class ResponsibleProducerDto {
  @ApiProperty({ description: 'Platform-native responsible-producer id' })
  id!: string;

  @ApiProperty({ description: 'Responsible-producer name (operator-facing label)' })
  name!: string;

  @ApiProperty({
    description: 'EU GPSR classification of the responsible-producer entry',
    enum: ResponsibleProducerKindValues,
  })
  kind!: ResponsibleProducerKind;
}

export class ResponsibleProducersResponseDto {
  @ApiProperty({ type: [ResponsibleProducerDto] })
  responsibleProducers!: ResponsibleProducerDto[];
}
