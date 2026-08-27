/**
 * Automation Response DTOs (#2363)
 *
 * Explicit projections, never a domain entity spread. Two of them carry the
 * property that makes this slice worth having:
 *
 * - **`AutomationActionAvailabilityDto` rides on every rule response**, so a
 *   saved rule is never presented as ready when five of its six possible actions
 *   cannot run in this build. The write path deliberately ACCEPTS all six
 *   (#2361 registers rather than omits the unavailable executors, so a firing is
 *   loud) — which means the API is where an operator learns what they can
 *   actually arm.
 * - **`AutomationRunLogResponseDto.recordingAvailable`** distinguishes "nothing
 *   fired" from "the run write path is not built yet" (#2385). Without it an
 *   empty log means both, and an operator resolving that ambiguity concludes
 *   their rule is broken.
 *
 * @module apps/api/src/automation/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AutomationActionAvailabilityValues,
  AutomationRunOutcomeValues,
  AutomationRunSubjectKindValues,
  AutomationTriggerValues,
  availabilityForAction,
  isAutomationActionKind,
  type AutomationAction,
  type AutomationActionAvailability,
  type AutomationCondition,
  type AutomationRule,
  type AutomationRun,
  type AutomationRunLogPage,
  type AutomationRunOutcome,
  type AutomationRunSubjectKind,
  type AutomationTrigger,
} from '@openlinker/core/automation';

export class AutomationActionAvailabilityDto {
  @ApiProperty() action!: string;
  @ApiProperty({ enum: AutomationActionAvailabilityValues })
  availability!: AutomationActionAvailability;
  @ApiProperty({ nullable: true, description: 'Why it cannot run, or only sometimes can.' })
  reason!: string | null;

  /**
   * Availability for one persisted step.
   *
   * A step naming an action this build does not recognise (a rule saved by a
   * newer build) reports `unavailable` with a reason saying exactly that — never
   * `available`, which would be a claim about an executor that does not exist.
   */
  static fromAction(action: string): AutomationActionAvailabilityDto {
    const dto = new AutomationActionAvailabilityDto();
    dto.action = action;
    if (!isAutomationActionKind(action)) {
      dto.availability = 'unavailable';
      dto.reason = `Action "${action}" is not part of this build's automation vocabulary.`;
      return dto;
    }
    const declared = availabilityForAction(action);
    dto.availability = declared.availability;
    dto.reason = declared.reason;
    return dto;
  }
}

export class AutomationRuleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: AutomationTriggerValues }) trigger!: AutomationTrigger;
  @ApiProperty({ type: Object }) triggerConfig!: Record<string, unknown>;
  @ApiProperty({ type: [Object] }) conditions!: readonly AutomationCondition[];
  @ApiProperty({ type: [Object] }) actions!: readonly AutomationAction[];
  @ApiProperty() definitionHash!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() effectiveFrom!: string;
  @ApiProperty({ nullable: true }) effectiveTo!: string | null;

  @ApiProperty({ description: 'Whether any step cannot be undone (spec §5.5 divergence 3).' })
  hasIrreversibleAction!: boolean;

  @ApiProperty({
    type: [AutomationActionAvailabilityDto],
    description: 'Per-step availability in THIS build, in the rule\'s own step order.',
  })
  actionAvailability!: AutomationActionAvailabilityDto[];

  @ApiProperty({
    nullable: true,
    description:
      'Who acknowledged arming this money-spending rule (§5.7 S3-2). Cleared whenever the definition changes.',
  })
  moneyAckByUserId!: string | null;
  @ApiProperty({ nullable: true }) moneyAckAt!: string | null;

  @ApiProperty({
    description:
      'Behavioural, not audit: the retroactivity floor a firing is compared against (spec §5.2).',
  })
  createdAt!: string;
  @ApiProperty() updatedAt!: string;

  static fromDomain(rule: AutomationRule): AutomationRuleResponseDto {
    const dto = new AutomationRuleResponseDto();
    dto.id = rule.id;
    dto.name = rule.name;
    dto.trigger = rule.trigger;
    dto.triggerConfig = rule.triggerConfig as Record<string, unknown>;
    dto.conditions = rule.conditions;
    dto.actions = rule.actions;
    dto.definitionHash = rule.definitionHash;
    dto.isActive = rule.isActive;
    dto.effectiveFrom = rule.effectiveFrom.toISOString();
    dto.effectiveTo = rule.effectiveTo ? rule.effectiveTo.toISOString() : null;
    dto.hasIrreversibleAction = rule.hasIrreversibleAction();
    dto.actionAvailability = rule.actions.map((step) =>
      AutomationActionAvailabilityDto.fromAction(step.action),
    );
    dto.moneyAckByUserId = rule.moneyAckByUserId;
    dto.moneyAckAt = rule.moneyAckAt ? rule.moneyAckAt.toISOString() : null;
    dto.createdAt = rule.createdAt.toISOString();
    dto.updatedAt = rule.updatedAt.toISOString();
    return dto;
  }
}

export class AutomationTriggerSummaryDto {
  @ApiProperty({ enum: AutomationTriggerValues }) trigger!: AutomationTrigger;
  @ApiProperty() ruleCount!: number;
}

export class AutomationRunResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() ruleId!: string;
  @ApiProperty({ description: 'Frozen at write time — history, not a live reference.' })
  ruleName!: string;
  @ApiProperty({ enum: AutomationTriggerValues }) trigger!: AutomationTrigger;
  @ApiProperty({ enum: AutomationRunSubjectKindValues })
  subjectKind!: AutomationRunSubjectKind;
  @ApiProperty() subjectId!: string;
  @ApiProperty({ enum: AutomationRunOutcomeValues }) outcome!: AutomationRunOutcome;
  @ApiProperty({
    type: [Object],
    description:
      'Per-step outcomes in order. A step that dispatched a job carries `syncJobId` — the job detail stays the place technical failure detail lives.',
  })
  steps!: readonly unknown[];
  @ApiProperty({
    nullable: true,
    type: [String],
    description: 'Only on `blocked`: every rule in the collision, this one included.',
  })
  blockedByRuleIds!: readonly string[] | null;
  @ApiProperty() firedAt!: string;

  static fromDomain(run: AutomationRun): AutomationRunResponseDto {
    const dto = new AutomationRunResponseDto();
    dto.id = run.id;
    dto.ruleId = run.ruleId;
    dto.ruleName = run.ruleName;
    dto.trigger = run.trigger;
    dto.subjectKind = run.subjectKind;
    dto.subjectId = run.subjectId;
    dto.outcome = run.outcome;
    dto.steps = run.steps;
    dto.blockedByRuleIds = run.blockedByRuleIds;
    dto.firedAt = run.firedAt.toISOString();
    return dto;
  }
}

export class AutomationRunLogResponseDto {
  @ApiProperty({ type: [AutomationRunResponseDto] }) runs!: AutomationRunResponseDto[];
  @ApiProperty() limit!: number;
  @ApiProperty({ description: 'The page is full; older runs may exist.' }) hasMore!: boolean;
  @ApiProperty({
    description:
      'Whether firings are persisted at all in this build. When `false`, an empty `runs` says NOTHING about whether the rule fired — the run write path (#2385) has not landed.',
  })
  recordingAvailable!: boolean;
  @ApiPropertyOptional({
    description: 'Operator-facing explanation, present only when `recordingAvailable` is false.',
  })
  note?: string;

  static fromDomain(page: AutomationRunLogPage): AutomationRunLogResponseDto {
    const dto = new AutomationRunLogResponseDto();
    dto.runs = page.runs.map((run) => AutomationRunResponseDto.fromDomain(run));
    dto.limit = page.limit;
    dto.hasMore = page.hasMore;
    dto.recordingAvailable = page.recordingAvailable;
    if (!page.recordingAvailable) {
      dto.note =
        'Automation runs are not recorded in this build yet, so this log stays empty even when rules fire. ' +
        'Firings are visible in the process log until the run write path lands.';
    }
    return dto;
  }
}
