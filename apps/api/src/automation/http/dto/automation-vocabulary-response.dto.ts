/**
 * Automation Vocabulary Response DTO (#2363, spec §5.2–§5.6)
 *
 * The FE's ONLY source of triggers, actions, conditions and the legality matrix
 * (the issue's third AC). Every field is projected from a declared table in
 * `@openlinker/core/automation` — nothing here restates a vocabulary, so a ninth
 * trigger or a seventh action reaches the composer by rebuilding rather than by
 * somebody remembering to edit two places.
 *
 * **`actions[].availability` is why this endpoint matters as much as the matrix.**
 * The legality matrix answers *"may this action follow this trigger?"* and says
 * nothing about whether OpenLinker ships the operation. Five of the six cannot
 * run today: A1/A2/A5/A6 are `unavailable` (no underlying operation exists), and
 * A4 is `partial` (`MAILER_TOKEN` is bound only in the API process, while the T4
 * deadline sweep fires from the worker). Presenting six ready actions would let
 * an operator arm one and learn the truth from a failed run — the silent-decline
 * defect class this programme keeps closing.
 *
 * @module apps/api/src/automation/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  AUTOMATION_ACTION_MAX_STEPS,
  AUTOMATION_ACTION_MIN_STEPS,
  AUTOMATION_LEGAL_ACTIONS,
  AUTOMATION_LEGAL_CONDITION_FIELDS,
  AUTOMATION_TRIGGER_FIRING_MODE,
  AutomationActionValues,
  AutomationAmountComparisonOpValues,
  AutomationConditionFieldValues,
  AutomationConditionOutcomeValues,
  AutomationNonFiringReasonValues,
  AutomationRunOutcomeValues,
  AutomationStepStatusValues,
  AutomationTriggerValues,
  availabilityForAction,
  isIrreversibleAction,
} from '@openlinker/core/automation';
import { HoldReasonValues } from '@openlinker/core/order-lifecycle';

import { AutomationActionAvailabilityDto } from './automation-response.dto';

/**
 * Which key a trigger's `triggerConfig` carries, so the composer renders one
 * numeric input rather than hard-coding "T3 means withinHours".
 */
const TRIGGER_CONFIG_KEY: Readonly<Record<string, string>> = {
  'order.on_hold_for': 'withinHours',
  'order.dispatch_deadline_near': 'hoursBefore',
};

export class AutomationTriggerVocabularyDto {
  @ApiProperty() value!: string;
  @ApiProperty({ description: '`edge` fires on a write; `deadline-sweep` on a clock crossing.' })
  firingMode!: string;
  @ApiProperty({
    nullable: true,
    description: 'The single `triggerConfig` key this trigger takes, or null for the parameterless six.',
  })
  configKey!: string | null;
  @ApiProperty({ type: [String], description: 'Actions legal for this trigger (§5.4).' })
  legalActions!: string[];
  @ApiProperty({ type: [String], description: 'Condition fields this trigger may be scoped by (§5.5).' })
  legalConditionFields!: string[];
}

export class AutomationActionVocabularyDto extends AutomationActionAvailabilityDto {
  @ApiProperty({ description: 'Obeys the #2047 at-most-one rule when several rules match.' })
  irreversible!: boolean;
}

export class AutomationVocabularyResponseDto {
  @ApiProperty({ type: [AutomationTriggerVocabularyDto] })
  triggers!: AutomationTriggerVocabularyDto[];
  @ApiProperty({ type: [AutomationActionVocabularyDto] })
  actions!: AutomationActionVocabularyDto[];
  @ApiProperty({ type: [String] }) conditionFields!: string[];
  @ApiProperty({ type: [String] }) amountOps!: string[];
  @ApiProperty({ type: [String] }) holdReasons!: string[];
  @ApiProperty({
    type: Object,
    description: 'The §5.4 matrix verbatim: `{ [trigger]: { [action]: boolean } }`.',
  })
  legalActions!: Record<string, Record<string, boolean>>;
  @ApiProperty({ type: Object })
  legalConditionFields!: Record<string, readonly string[]>;
  @ApiProperty({ type: Object }) stepBounds!: { min: number; max: number };

  @ApiProperty({ type: [String], description: 'Closed run outcomes (§5.6).' })
  runOutcomes!: string[];
  @ApiProperty({ type: [String], description: 'Closed per-step statuses (§5.6).' })
  stepStatuses!: string[];
  @ApiProperty({ type: [String], description: 'Closed non-firing reasons — the dry run renders these.' })
  nonFiringReasons!: string[];
  @ApiProperty({ type: [String], description: 'Closed per-condition outcomes.' })
  conditionOutcomes!: string[];

  static build(): AutomationVocabularyResponseDto {
    const dto = new AutomationVocabularyResponseDto();
    dto.triggers = AutomationTriggerValues.map((trigger) => {
      const entry = new AutomationTriggerVocabularyDto();
      entry.value = trigger;
      entry.firingMode = AUTOMATION_TRIGGER_FIRING_MODE[trigger];
      entry.configKey = TRIGGER_CONFIG_KEY[trigger] ?? null;
      entry.legalActions = AutomationActionValues.filter(
        (action) => AUTOMATION_LEGAL_ACTIONS[trigger][action],
      );
      entry.legalConditionFields = [...AUTOMATION_LEGAL_CONDITION_FIELDS[trigger]];
      return entry;
    });
    dto.actions = AutomationActionValues.map((action) => {
      const declared = availabilityForAction(action);
      const entry = new AutomationActionVocabularyDto();
      entry.action = action;
      entry.availability = declared.availability;
      entry.reason = declared.reason;
      entry.irreversible = isIrreversibleAction(action);
      return entry;
    });
    dto.conditionFields = [...AutomationConditionFieldValues];
    dto.amountOps = [...AutomationAmountComparisonOpValues];
    dto.holdReasons = [...HoldReasonValues];
    dto.legalActions = AUTOMATION_LEGAL_ACTIONS as unknown as Record<
      string,
      Record<string, boolean>
    >;
    dto.legalConditionFields = AUTOMATION_LEGAL_CONDITION_FIELDS as unknown as Record<
      string,
      readonly string[]
    >;
    dto.stepBounds = { min: AUTOMATION_ACTION_MIN_STEPS, max: AUTOMATION_ACTION_MAX_STEPS };
    dto.runOutcomes = [...AutomationRunOutcomeValues];
    dto.stepStatuses = [...AutomationStepStatusValues];
    dto.nonFiringReasons = [...AutomationNonFiringReasonValues];
    dto.conditionOutcomes = [...AutomationConditionOutcomeValues];
    return dto;
  }
}
