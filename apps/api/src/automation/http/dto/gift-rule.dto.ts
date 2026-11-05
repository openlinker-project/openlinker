/**
 * Gift Rule DTOs (#3938)
 *
 * Request and response shapes of the gift-rule surface. A gift rule is an
 * automation rule with the trigger fixed to `order.ingested` and exactly one
 * `add-gift` step, so the write body carries the gift as its own typed object
 * rather than a one-element action array: the operator composes "a gift", not a
 * list. The core narrowers (`isAutomationGiftAction`, `isAutomationCondition`)
 * stay the authority - the validators here only keep an absurd body from being
 * parsed.
 *
 * @module apps/api/src/automation/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  AutomationGiftDocumentFormValues,
  GiftRulePauseReasonValues,
  type AutomationGiftAction,
  type AutomationGiftDocumentForm,
  type AutomationRule,
  type AutomationRuleEvaluation,
  type GiftRuleOutcome,
  type GiftRulePauseReason,
  type GiftRuleView,
} from '@openlinker/core/automation';

export class GiftPerUnitDto {
  @ApiProperty({ description: 'Internal product id whose units are counted.' })
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ description: 'Units of that product per gift batch (1 = every unit).' })
  @IsInt()
  @Min(1)
  per!: number;

  @ApiProperty({ nullable: true, description: 'Most gift batches in one order; null = no ceiling.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxPerOrder!: number | null;
}

export class GiftDefinitionDto {
  @ApiProperty({ description: 'Internal product id of the gift.' })
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ description: 'Internal variant id of the gift.' })
  @IsString()
  @IsNotEmpty()
  variantId!: string;

  @ApiProperty({ description: 'Units per batch.' })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ type: GiftPerUnitDto, nullable: true, description: '"For every unit bought" mode.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => GiftPerUnitDto)
  perUnit?: GiftPerUnitDto | null;

  @ApiPropertyOptional({ nullable: true, description: 'Unit cap for the whole rule; reaching it pauses the rule.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  unitCap?: number | null;

  @ApiPropertyOptional({ description: 'Skip when the gift is already in the order. Default true (R5).' })
  @IsOptional()
  @IsBoolean()
  skipIfPresent?: boolean;

  @ApiPropertyOptional({ description: 'A matching rule with this on stops the rules below it. Default false (R3).' })
  @IsOptional()
  @IsBoolean()
  doNotCombine?: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Max gift units per resolved customer; null = off (R7).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  customerLimit?: number | null;

  @ApiPropertyOptional({
    enum: AutomationGiftDocumentFormValues,
    description: 'Per-gift document form. Absent means "as in settings".',
  })
  @IsOptional()
  @IsIn(AutomationGiftDocumentFormValues as readonly string[])
  documentForm?: AutomationGiftDocumentForm;

  toAction(): AutomationGiftAction {
    return {
      action: 'add-gift',
      productId: this.productId,
      variantId: this.variantId,
      quantity: this.quantity,
      perUnit:
        this.perUnit === undefined || this.perUnit === null
          ? null
          : {
              productId: this.perUnit.productId,
              per: this.perUnit.per,
              maxPerOrder: this.perUnit.maxPerOrder ?? null,
            },
      unitCap: this.unitCap ?? null,
      skipIfPresent: this.skipIfPresent ?? true,
      doNotCombine: this.doNotCombine ?? false,
      customerLimit: this.customerLimit ?? null,
      ...(this.documentForm !== undefined && { documentForm: this.documentForm }),
    };
  }
}

export class WriteGiftRuleDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    type: [Object],
    description:
      'AND-ed conditions: containsProduct, orderTotalGross (gte, one currency), sourceConnection, ' +
      'sourceConnectionIn (channels), orderCountry. Narrowed server-side.',
  })
  @IsArray()
  @ArrayMaxSize(20)
  conditions!: unknown[];

  @ApiProperty({ type: GiftDefinitionDto })
  @ValidateNested()
  @Type(() => GiftDefinitionDto)
  gift!: GiftDefinitionDto;

  @ApiPropertyOptional({ description: 'Omitted means inactive: a rule is switched on deliberately.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ description: 'ISO date. A rule never applies to an order placed before it was saved.' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;
}

export class ReorderGiftRulesDto {
  @ApiProperty({ type: [String], description: 'EVERY gift rule id, once each, in the new list order.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  ruleIds!: string[];
}

export class ResumeGiftRuleDto {
  @ApiProperty({ description: 'Units to add to the cap. The rule resumes with that much room.' })
  @IsInt()
  @Min(1)
  additionalUnits!: number;
}

export class EvaluateGiftRulesDto {
  @ApiProperty({ description: 'The order to evaluate against. Nothing about it is written.' })
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  @ApiPropertyOptional({ description: 'Mark one saved rule as the subject of the answer.' })
  @IsOptional()
  @IsString()
  ruleId?: string;

  @ApiPropertyOptional({ type: WriteGiftRuleDto, description: 'An unsaved draft to test beside the saved rules.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => WriteGiftRuleDto)
  rule?: WriteGiftRuleDto;
}

export type GiftRuleStatus = 'inactive' | 'scheduled' | 'active' | 'paused' | 'ended';

export class GiftRuleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ nullable: true }) position!: number | null;
  @ApiProperty() effectiveFrom!: string;
  @ApiProperty({ nullable: true }) effectiveTo!: string | null;
  @ApiProperty({ type: [Object] }) conditions!: readonly unknown[];
  @ApiProperty({ type: Object }) gift!: AutomationGiftAction | null;
  @ApiProperty({
    enum: ['inactive', 'scheduled', 'active', 'paused', 'ended'],
    description: 'A derived read for the list; `paused` carries `pausedReason`.',
  })
  status!: GiftRuleStatus;
  @ApiProperty({ enum: GiftRulePauseReasonValues, nullable: true })
  pausedReason!: GiftRulePauseReason | null;
  @ApiProperty({ nullable: true }) pausedAt!: string | null;
  @ApiProperty({ description: 'Gift units given so far, from the grant ledger.' })
  unitsGiven!: number;
  @ApiProperty({ nullable: true, description: 'Unit cap plus any units added by resuming; null = no cap.' })
  effectiveCap!: number | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  static fromView(view: GiftRuleView, now: Date = new Date()): GiftRuleResponseDto {
    const { rule, state } = view;
    const dto = new GiftRuleResponseDto();
    dto.id = rule.id;
    dto.name = rule.name;
    dto.isActive = rule.isActive;
    dto.position = rule.position;
    dto.effectiveFrom = rule.effectiveFrom.toISOString();
    dto.effectiveTo = rule.effectiveTo ? rule.effectiveTo.toISOString() : null;
    dto.conditions = rule.conditions;
    const step = rule.actions.find((a) => a.action === 'add-gift');
    dto.gift = step !== undefined && step.action === 'add-gift' ? step : null;
    dto.pausedReason = state?.pausedReason ?? null;
    dto.pausedAt = state?.pausedAt ? state.pausedAt.toISOString() : null;
    dto.unitsGiven = view.unitsGiven;
    dto.effectiveCap = view.effectiveCap;
    dto.status = GiftRuleResponseDto.statusOf(rule, dto.pausedReason, now);
    dto.createdAt = rule.createdAt.toISOString();
    dto.updatedAt = rule.updatedAt.toISOString();
    return dto;
  }

  private static statusOf(
    rule: AutomationRule,
    pausedReason: GiftRulePauseReason | null,
    now: Date,
  ): GiftRuleStatus {
    if (rule.effectiveTo !== null && rule.effectiveTo.getTime() < now.getTime()) return 'ended';
    if (!rule.isActive) return 'inactive';
    if (rule.effectiveFrom.getTime() > now.getTime()) return 'scheduled';
    return pausedReason === null ? 'active' : 'paused';
  }
}

export class GiftDryRunVerdictDto {
  @ApiProperty() ruleId!: string;
  @ApiProperty() ruleName!: string;
  @ApiProperty() isSubject!: boolean;
  @ApiProperty({ description: 'The rule would add its gift to this order.' }) wouldApply!: boolean;
  @ApiProperty({ description: 'Gift units it would add; 0 when it would not.' }) quantity!: number;
  @ApiProperty({ nullable: true, description: 'Why it would not, as a named reason.' }) reason!: string | null;
  @ApiProperty({ nullable: true, description: 'The evaluator\'s own reason, with `rule-not-matching`.' })
  nonFiringReason!: string | null;
  @ApiProperty({ nullable: true, description: 'The earlier "do not combine" rule that stopped this one.' })
  supersededByRuleId!: string | null;
  @ApiProperty({ type: [Object], description: 'Every condition with its outcome, for the "why".' })
  conditionTraces!: readonly unknown[];
  @ApiProperty() retroactivityFloorWaived!: boolean;
}

export class GiftDryRunResponseDto {
  @ApiProperty() orderId!: string;
  @ApiProperty() evaluatedAt!: string;
  @ApiProperty({ type: [GiftDryRunVerdictDto] }) verdicts!: GiftDryRunVerdictDto[];

  static from(
    orderId: string,
    evaluatedAt: Date,
    evaluations: readonly AutomationRuleEvaluation[],
    outcomes: readonly GiftRuleOutcome[],
    subjectRuleId: string | null,
  ): GiftDryRunResponseDto {
    const evaluationById = new Map(evaluations.map((e) => [e.ruleId, e] as const));
    const dto = new GiftDryRunResponseDto();
    dto.orderId = orderId;
    dto.evaluatedAt = evaluatedAt.toISOString();
    dto.verdicts = outcomes.map((outcome) => {
      const evaluation = evaluationById.get(outcome.ruleId);
      const verdict = new GiftDryRunVerdictDto();
      verdict.ruleId = outcome.ruleId;
      verdict.ruleName = outcome.ruleName;
      verdict.isSubject = outcome.ruleId === subjectRuleId;
      verdict.wouldApply = outcome.applied;
      verdict.quantity = outcome.quantity;
      verdict.reason = outcome.reason;
      verdict.nonFiringReason = outcome.nonFiringReason;
      verdict.supersededByRuleId = outcome.supersededByRuleId;
      verdict.conditionTraces = evaluation?.conditionTraces ?? [];
      verdict.retroactivityFloorWaived = evaluation?.retroactivityFloorWaived ?? false;
      return verdict;
    });
    return dto;
  }
}
