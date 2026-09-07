/**
 * Create Sourcing Rule DTO (#2953)
 *
 * Request body for POST /connections/:connectionId/sourcing-rules.
 *
 * Every `@IsIn` reads the exported `as const` tuple from `@openlinker/oms` — no
 * vocabulary member is re-spelled here, so a name added to the closed set is
 * accepted the moment it is declared.
 *
 * **These decorators are a fast, well-formedness rejection, not the gate.** They
 * cannot express the kind-to-name pairing: `{kind: 'filter', name: 'nearest'}`
 * passes the union `@IsIn` below and is refused by `SourcingRuleAdminService`,
 * which round-trips the candidate through `coerceRoutingRule`. Tightening this
 * DTO is not a substitute for that check.
 *
 * The class is named `*SourcingRule*`, never `*RoutingRule*`: `@nestjs/swagger`
 * keys schema definitions by CLASS NAME, and
 * `apps/api/src/mappings/http/dto/routing-rule-response.dto.ts` already owns
 * that name for the unrelated ADR-012 dispatch surface — a second class of the
 * same name silently overwrites the first in the generated OpenAPI document.
 *
 * @module apps/api/src/oms/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
import {
  RoutingAfterActionValues,
  RoutingFilterNameValues,
  RoutingRuleKindValues,
  RoutingSortNameValues,
  type RoutingAfterAction,
  type RoutingRuleKind,
} from '@openlinker/oms';

/** Union of both vocabularies; the kind-to-name pairing is the service's check. */
export const SOURCING_RULE_NAME_VALUES = [
  ...RoutingFilterNameValues,
  ...RoutingSortNameValues,
] as const;

export class CreateSourcingRuleDto {
  @ApiProperty({
    description:
      'Ascending evaluation order within the ruleset. REQUIRED — ordering is part of the ' +
      'contract, so it is stated rather than derived from insertion time. Duplicates are ' +
      'legal (ties break on rule id); `PUT /order` is what assigns a dense 1..N.',
    example: 1,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  position!: number;

  @ApiProperty({
    enum: RoutingRuleKindValues,
    description: 'Whether the rule eliminates candidate locations (filter) or ranks them (sort).',
  })
  @IsIn(RoutingRuleKindValues)
  kind!: RoutingRuleKind;

  @ApiProperty({
    enum: SOURCING_RULE_NAME_VALUES,
    description:
      'Must belong to the vocabulary of the chosen `kind`. A filter name on a sort rule (or ' +
      'vice versa) is refused — such a rule would save and then never be evaluated.',
  })
  @IsIn(SOURCING_RULE_NAME_VALUES)
  name!: string;

  @ApiProperty({
    enum: RoutingAfterActionValues,
    description:
      'What the rule permits once it has run. A ruleset resolves to the MOST RESTRICTIVE ' +
      'after-action any of its rules declares.',
  })
  @IsIn(RoutingAfterActionValues)
  afterAction!: RoutingAfterAction;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Operator-authored location order, read ONLY by the `priority` sort. Must be empty for ' +
      'every other rule, which would ignore it.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  priorityLocationIds?: string[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'ISO-8601. The rule is not evaluated before this instant. Null = always open.',
  })
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'ISO-8601. The rule stops being evaluated at this instant. A rule retiring in the ' +
      'FUTURE is still live now, so it is still listed and still reorderable.',
  })
  @IsOptional()
  @IsISO8601()
  effectiveTo?: string | null;
}
