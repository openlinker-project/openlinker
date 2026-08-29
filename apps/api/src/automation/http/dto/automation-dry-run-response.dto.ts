/**
 * Automation Dry-Run Response DTO (#2363, Wave-2 spec §5.6a)
 *
 * ## The facts are PROJECTED, and the order snapshot is never echoed
 *
 * `AutomationSubjectFactsDto` enumerates the five facts the evaluator actually
 * used, one field at a time. It must never become a spread of
 * `OrderRecord.orderSnapshot`: under `OL_STORE_PII=true` that snapshot carries
 * the buyer's name, email and address, and this is a DIAGNOSTICS endpoint whose
 * only job is explaining why a rule did not fire. "It is visible elsewhere to
 * the same roles" is an argument about one deployment's role assignment, not
 * about this endpoint's contract — and a contract that leaks whenever the roles
 * are widened is one nobody can reason about.
 *
 * The five are also exactly what makes the trace readable: every condition in
 * the §5.5 vocabulary is about one of them, so an operator seeing `country:
 * null` beside an `orderCountry` condition reading `unknown` has the whole
 * explanation in front of them.
 *
 * ## `wouldFire` is not `matches`
 *
 * They differ precisely when the #2362 at-most-one gate refused a rule that DID
 * match — the S3-3 two-money-rules case. `blockedBy` then names every rule in
 * the collision (this one included) and **which irreversible actions** collided,
 * because an operator cannot remediate a collision they cannot name.
 *
 * @module apps/api/src/automation/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AutomationActionAvailabilityValues,
  AutomationConditionOutcomeValues,
  AutomationNonFiringReasonValues,
  AutomationRunSubjectKindValues,
  AutomationTriggerValues,
  type AutomationCondition,
  type AutomationConditionField,
  type AutomationConditionOutcome,
  type AutomationNonFiringReason,
  type AutomationTrigger,
} from '@openlinker/core/automation';

import type { AutomationDryRunResult } from '../../application/automation-dry-run.service.interface';

export class AutomationSubjectFactsDto {
  @ApiProperty({ enum: AutomationRunSubjectKindValues }) subjectKind!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty({
    nullable: true,
    description: 'When the triggering fact occurred. Null means UNKNOWN, never "no".',
  })
  occurredAt!: string | null;
  @ApiProperty({ nullable: true }) sourceConnectionId!: string | null;
  @ApiProperty({ nullable: true }) country!: string | null;
  @ApiProperty({ nullable: true }) totalGross!: number | null;
  @ApiProperty({ nullable: true }) currency!: string | null;
}

export class AutomationConditionTraceDto {
  @ApiProperty() field!: AutomationConditionField;
  @ApiProperty({ type: Object }) condition!: AutomationCondition;
  @ApiProperty({
    enum: AutomationConditionOutcomeValues,
    description:
      '`unknown` and `currency-mismatch` are distinct from `false`: the first two are things the operator can fix, the third is a rule they may want to keep.',
  })
  outcome!: AutomationConditionOutcome;
}

export class AutomationBlockedByDto {
  @ApiProperty({ type: [String], description: 'Every rule in the collision, this one included.' })
  collidingRuleIds!: readonly string[];
  @ApiProperty({
    type: [String],
    description: 'WHICH irreversible actions collided — not merely that one did.',
  })
  actions!: readonly string[];
}

export class AutomationStepAvailabilityDto {
  @ApiProperty() action!: string;
  @ApiProperty({ enum: AutomationActionAvailabilityValues }) availability!: string;
  @ApiProperty({ nullable: true }) reason!: string | null;
}

export class AutomationDryRunVerdictDto {
  @ApiProperty() ruleId!: string;
  @ApiProperty() ruleName!: string;
  @ApiProperty({ description: 'The rule the caller asked about.' }) isSubject!: boolean;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ description: 'The evaluator matched it.' }) matches!: boolean;
  @ApiProperty({
    description: '`matches` AND the at-most-one gate let it through. This is the sentence to arm on.',
  })
  wouldFire!: boolean;
  @ApiProperty({ enum: AutomationNonFiringReasonValues, nullable: true })
  nonFiringReason!: AutomationNonFiringReason | null;
  @ApiProperty({
    type: [AutomationConditionTraceDto],
    description:
      "Every condition in the rule's own order — built even when something else already ruled the rule out. Empty only for a rule about a different event.",
  })
  conditionTraces!: AutomationConditionTraceDto[];
  @ApiProperty({
    description:
      'The rule matches, but the order predates it — so it would NOT have fired for real. The dry run waives the retroactivity floor; nothing else does.',
  })
  retroactivityFloorWaived!: boolean;
  @ApiPropertyOptional({ type: AutomationBlockedByDto, nullable: true })
  blockedBy!: AutomationBlockedByDto | null;
  @ApiProperty({ type: [AutomationStepAvailabilityDto] })
  stepAvailability!: AutomationStepAvailabilityDto[];
}

export class AutomationDryRunResponseDto {
  @ApiProperty({ enum: AutomationTriggerValues }) trigger!: AutomationTrigger;
  @ApiProperty({
    type: AutomationSubjectFactsDto,
    description: 'The facts the evaluator used — a projection, never the order snapshot.',
  })
  facts!: AutomationSubjectFactsDto;
  @ApiProperty() evaluatedAt!: string;
  @ApiProperty({
    type: [AutomationDryRunVerdictDto],
    description:
      'Every rule scoped to the trigger, plus the subject. Siblings are included so a two-money-rules collision is visible before it costs a second label.',
  })
  verdicts!: AutomationDryRunVerdictDto[];

  static fromDomain(result: AutomationDryRunResult): AutomationDryRunResponseDto {
    const dto = new AutomationDryRunResponseDto();
    dto.trigger = result.trigger;

    const facts = new AutomationSubjectFactsDto();
    facts.subjectKind = result.facts.subjectKind;
    facts.subjectId = result.facts.subjectId;
    // `undefined` becomes `null` on the wire deliberately: an absent JSON key and
    // an explicit null read the same to a client, and this endpoint's whole point
    // is that "we could not tell" is a visible answer rather than a gap.
    facts.occurredAt = result.facts.occurredAt ? result.facts.occurredAt.toISOString() : null;
    facts.sourceConnectionId = result.facts.sourceConnectionId ?? null;
    facts.country = result.facts.country ?? null;
    facts.totalGross = result.facts.totalGross ?? null;
    facts.currency = result.facts.currency ?? null;
    dto.facts = facts;

    dto.evaluatedAt = result.evaluatedAt.toISOString();
    dto.verdicts = result.verdicts.map((verdict) => {
      const entry = new AutomationDryRunVerdictDto();
      entry.ruleId = verdict.ruleId;
      entry.ruleName = verdict.ruleName;
      entry.isSubject = verdict.isSubject;
      entry.isActive = verdict.isActive;
      entry.matches = verdict.matches;
      entry.wouldFire = verdict.wouldFire;
      entry.nonFiringReason = verdict.nonFiringReason;
      entry.conditionTraces = verdict.conditionTraces.map((trace) => {
        const row = new AutomationConditionTraceDto();
        row.field = trace.field;
        row.condition = trace.condition;
        row.outcome = trace.outcome;
        return row;
      });
      entry.retroactivityFloorWaived = verdict.retroactivityFloorWaived;
      if (verdict.blockedBy === null) {
        entry.blockedBy = null;
      } else {
        const blocked = new AutomationBlockedByDto();
        blocked.collidingRuleIds = verdict.blockedBy.collidingRuleIds;
        blocked.actions = verdict.blockedBy.actions;
        entry.blockedBy = blocked;
      }
      entry.stepAvailability = verdict.stepAvailability.map((step) => {
        const row = new AutomationStepAvailabilityDto();
        row.action = step.action;
        row.availability = step.availability;
        row.reason = step.reason;
        return row;
      });
      return entry;
    });
    return dto;
  }
}
