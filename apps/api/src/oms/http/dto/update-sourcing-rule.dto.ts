/**
 * Update Sourcing Rule DTO (#2953)
 *
 * Request body for PATCH /connections/:connectionId/sourcing-rules/:ruleId.
 *
 * **`kind` is deliberately absent.** It is half a rule's identity under
 * `UQ_oms_routing_rules_live_name`, so changing it is delete-and-recreate rather
 * than a patch — and a `kind` change would silently invalidate the row's `name`,
 * which the patch may not even carry.
 *
 * @module apps/api/src/oms/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { RoutingAfterActionValues, type RoutingAfterAction } from '@openlinker/oms';

import { SOURCING_RULE_NAME_VALUES } from './create-sourcing-rule.dto';

export class UpdateSourcingRuleDto {
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @ApiPropertyOptional({
    enum: SOURCING_RULE_NAME_VALUES,
    description: "Validated against the row's own (unchangeable) kind.",
  })
  @IsOptional()
  @IsIn(SOURCING_RULE_NAME_VALUES)
  name?: string;

  @ApiPropertyOptional({ enum: RoutingAfterActionValues })
  @IsOptional()
  @IsIn(RoutingAfterActionValues)
  afterAction?: RoutingAfterAction;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  priorityLocationIds?: string[];

  @ApiPropertyOptional({ nullable: true, description: 'ISO-8601, or null to clear.' })
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'ISO-8601, or null to clear. Setting a past instant RETIRES the rule while keeping it ' +
      'for history; clearing it revives the rule, which is refused (409) if a live sibling ' +
      'already claims the same kind and name.',
  })
  @IsOptional()
  @IsISO8601()
  effectiveTo?: string | null;
}
