/**
 * Automation Rule Request DTOs (#2363)
 *
 * Boundary validation for the rule write path. Shape only — the semantic
 * refusals (the §5.4 legality matrix, the step-count cap, the condition and
 * action narrowers, the duplicate guard) all live in
 * `AutomationRulesService`, which is the write choke point every caller reaches.
 * Re-implementing them here would give them a second place to drift, and the
 * one that mattered would be the one a `curl` bypasses.
 *
 * `conditions` and `actions` are therefore validated as ARRAYS OF OBJECTS and no
 * further. `AutomationRuleInput` types them `readonly unknown[]` deliberately —
 * its own docblock says typing them as already-narrowed would let a caller
 * type-assert past the only validation that exists.
 *
 * @module apps/api/src/automation/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  AUTOMATION_ACTION_MAX_STEPS,
  AutomationTriggerValues,
  type AutomationTrigger,
} from '@openlinker/core/automation';

/** A rule definition, as the composer submits it. */
export class AutomationRuleDefinitionDto {
  @ApiProperty({ description: 'Operator-facing name; rendered on the timeline and run log.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ enum: AutomationTriggerValues })
  @IsIn(AutomationTriggerValues as readonly string[])
  trigger!: AutomationTrigger;

  @ApiProperty({
    description:
      "The trigger's own parameters — T3's `withinHours`, T4's `hoursBefore`; `{}` for the six parameterless triggers.",
    type: Object,
  })
  @IsObject()
  triggerConfig!: Record<string, unknown>;

  @ApiProperty({
    description: 'AND-ed, closed-vocabulary conditions. Narrowed server-side.',
    type: [Object],
  })
  @IsArray()
  conditions!: unknown[];

  @ApiProperty({
    description: `Ordered steps, 1..${AUTOMATION_ACTION_MAX_STEPS}, stop on first failure. Narrowed server-side.`,
    type: [Object],
  })
  @IsArray()
  // A shape-level cap beside the service's own: the service refuses the same
  // count with a domain error, and this only stops an absurd body being parsed
  // and hashed first. It is not the enforcement point.
  @ArrayMaxSize(AUTOMATION_ACTION_MAX_STEPS)
  actions!: unknown[];

  @ApiPropertyOptional({
    description:
      'Armed or not. **Omitted means inactive** — a rule is armed deliberately, never by default.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ description: 'ISO date. The rule does not apply before this day.' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional({ description: 'ISO date, or null for open-ended.', nullable: true })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;
}

/**
 * A create or replace.
 *
 * `moneyAcknowledged` is the §5.7 S3-2 acknowledgement — that the operator armed
 * a money-spending rule they could not test first. It is a BOOLEAN, never a user
 * id: the acting user is taken from the verified token, because a body-supplied
 * actor would let a caller attribute their own decision to someone else in the
 * record that exists to say who decided.
 */
export class WriteAutomationRuleDto extends AutomationRuleDefinitionDto {
  @ApiPropertyOptional({
    description:
      'Required when arming a rule that carries an irreversible action (issue-sales-document, dispatch-shipment).',
  })
  @IsOptional()
  @IsBoolean()
  moneyAcknowledged?: boolean;
}
