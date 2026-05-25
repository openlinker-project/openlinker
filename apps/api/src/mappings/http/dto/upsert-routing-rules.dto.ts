/**
 * Upsert Routing Rules DTO
 *
 * Replace-all body for a source connection's fulfillment-routing rules (#836).
 * Only diverted methods are included; omitted methods fall back to the
 * `omp_fulfilled` default (rule absence).
 *
 * @module apps/api/src/mappings/http/dto
 */

import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { RoutingRuleInputDto } from './routing-rule-input.dto';

export class UpsertRoutingRulesDto {
  @ApiProperty({ type: [RoutingRuleInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoutingRuleInputDto)
  items!: RoutingRuleInputDto[];
}
