/**
 * Automation Schemas (#2364)
 *
 * Zod parse of every #2363 response this feature reads.
 *
 * **`.nullish()`, never `.optional()` (#939).** OpenLinker serialises an absent
 * optional field as JSON `null`, and a bare `.optional()` rejects `null` — the
 * failure that once blanked a whole address section from one empty field.
 *
 * **Per-row drops are non-fatal and counted.** A single malformed rule drops
 * itself and is reported rather than failing the page, the `returns.schema.ts`
 * precedent. The distinction the callers rely on: a dropped row is a row the
 * server sent that this build could not read, which is a different claim from
 * "the server sent none" — and rendering the second when the first is true is
 * the false-statement class this feature exists to avoid making.
 *
 * @module apps/web/src/features/automation/api
 */
import { z } from 'zod/v4';
import {
  AUTOMATION_ACTION_AVAILABILITY_VALUES,
  AUTOMATION_CONDITION_OUTCOME_VALUES,
  AUTOMATION_FIRING_MODE_VALUES,
  AUTOMATION_NON_FIRING_REASON_VALUES,
  AUTOMATION_STEP_STATUS_VALUES,
  AUTOMATION_TRIGGER_VALUES,
  type AutomationDryRunResult,
  type AutomationStepResult,
  type AutomationRule,
  type AutomationRun,
  type AutomationRunLog,
  type AutomationTriggerSummary,
  type AutomationVocabulary,
} from './automation.types';

const availabilityEntrySchema = z.object({
  action: z.string(),
  availability: z.enum(AUTOMATION_ACTION_AVAILABILITY_VALUES),
  reason: z.string().nullish(),
});

const actionVocabularySchema = availabilityEntrySchema.extend({
  irreversible: z.boolean(),
});

const triggerVocabularySchema = z.object({
  value: z.enum(AUTOMATION_TRIGGER_VALUES),
  firingMode: z.enum(AUTOMATION_FIRING_MODE_VALUES),
  configKey: z.string().nullish(),
  legalActions: z.array(z.string()),
  legalConditionFields: z.array(z.string()),
});

const vocabularySchema = z.object({
  triggers: z.array(triggerVocabularySchema),
  actions: z.array(actionVocabularySchema),
  conditionFields: z.array(z.string()),
  amountOps: z.array(z.string()),
  holdReasons: z.array(z.string()),
  stepBounds: z.object({ min: z.number(), max: z.number() }),
  runOutcomes: z.array(z.string()),
  stepStatuses: z.array(z.string()),
  nonFiringReasons: z.array(z.string()),
  conditionOutcomes: z.array(z.string()),
});

/**
 * The vocabulary is parsed ALL-OR-NOTHING and throws on failure.
 *
 * Deliberately unlike the row-level degradation elsewhere in this file. It is
 * the only source of the legality matrix and of what each action can do, so a
 * partially-read vocabulary would let the UI render a confident, wrong answer —
 * an empty availability panel reads as "this build ships no actions", which is
 * a claim, not a gap. Throwing routes the screen to its error branch, which
 * says the truth: we could not read it.
 */
export function parseAutomationVocabulary(raw: unknown): AutomationVocabulary {
  const parsed = vocabularySchema.parse(raw);
  return {
    ...parsed,
    triggers: parsed.triggers.map((trigger) => ({
      ...trigger,
      configKey: trigger.configKey ?? null,
    })),
    actions: parsed.actions.map((action) => ({ ...action, reason: action.reason ?? null })),
  };
}

const summarySchema = z.object({
  trigger: z.enum(AUTOMATION_TRIGGER_VALUES),
  ruleCount: z.number(),
});

export interface ParsedAutomationSummary {
  items: AutomationTriggerSummary[];
  /** Entries the server sent that this build could not read. Reported, never hidden. */
  droppedCount: number;
}

export function parseAutomationSummary(raw: unknown): ParsedAutomationSummary {
  const envelope = z.array(z.unknown()).safeParse(raw);
  if (!envelope.success) return { items: [], droppedCount: 0 };

  const items: AutomationTriggerSummary[] = [];
  let droppedCount = 0;
  for (const entry of envelope.data) {
    const parsed = summarySchema.safeParse(entry);
    if (parsed.success) items.push(parsed.data);
    else droppedCount += 1;
  }
  return { items, droppedCount };
}

const ruleSchema = z.object({
  id: z.string(),
  name: z.string(),
  trigger: z.enum(AUTOMATION_TRIGGER_VALUES),
  triggerConfig: z.record(z.string(), z.unknown()).nullish(),
  conditions: z.array(z.unknown()).nullish(),
  actions: z.array(z.unknown()).nullish(),
  definitionHash: z.string(),
  isActive: z.boolean(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullish(),
  hasIrreversibleAction: z.boolean(),
  actionAvailability: z.array(availabilityEntrySchema).nullish(),
  moneyAckByUserId: z.string().nullish(),
  moneyAckAt: z.string().nullish(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

function toRule(parsed: z.infer<typeof ruleSchema>): AutomationRule {
  return {
    ...parsed,
    triggerConfig: parsed.triggerConfig ?? {},
    conditions: parsed.conditions ?? [],
    actions: parsed.actions ?? [],
    effectiveTo: parsed.effectiveTo ?? null,
    actionAvailability: (parsed.actionAvailability ?? []).map((entry) => ({
      ...entry,
      reason: entry.reason ?? null,
    })),
    moneyAckByUserId: parsed.moneyAckByUserId ?? null,
    moneyAckAt: parsed.moneyAckAt ?? null,
  };
}

export function parseAutomationRule(raw: unknown): AutomationRule {
  return toRule(ruleSchema.parse(raw));
}

export interface ParsedAutomationRules {
  items: AutomationRule[];
  droppedCount: number;
}

export function parseAutomationRules(raw: unknown): ParsedAutomationRules {
  const envelope = z.array(z.unknown()).safeParse(raw);
  if (!envelope.success) return { items: [], droppedCount: 0 };

  const items: AutomationRule[] = [];
  let droppedCount = 0;
  for (const entry of envelope.data) {
    const parsed = ruleSchema.safeParse(entry);
    if (parsed.success) items.push(toRule(parsed.data));
    else droppedCount += 1;
  }
  return { items, droppedCount };
}

/**
 * One step of a firing.
 *
 * `steps` is `readonly unknown[]` server-side (#2385 may widen it), so this is
 * the one open shape in the automation frontend — parsed per step, dropped and
 * counted rather than failing the log.
 */
const stepSchema = z.object({
  stepIndex: z.number(),
  action: z.string(),
  status: z.enum(AUTOMATION_STEP_STATUS_VALUES),
  detail: z.string().nullish(),
  syncJobId: z.string().nullish(),
  unavailableReason: z.string().nullish(),
});

function parseSteps(raw: unknown): { steps: AutomationStepResult[]; unreadable: number } {
  const list = z.array(z.unknown()).safeParse(raw);
  if (!list.success) return { steps: [], unreadable: 0 };

  const steps: AutomationStepResult[] = [];
  let unreadable = 0;
  for (const entry of list.data) {
    const parsed = stepSchema.safeParse(entry);
    if (!parsed.success) {
      unreadable += 1;
      continue;
    }
    steps.push({
      ...parsed.data,
      detail: parsed.data.detail ?? null,
      syncJobId: parsed.data.syncJobId ?? null,
      unavailableReason: parsed.data.unavailableReason ?? null,
    });
  }
  return { steps, unreadable };
}

const runSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  ruleName: z.string(),
  trigger: z.string(),
  subjectKind: z.string(),
  subjectId: z.string(),
  outcome: z.string(),
  steps: z.unknown().nullish(),
  blockedByRuleIds: z.array(z.string()).nullish(),
  firedAt: z.string(),
});

const runLogSchema = z.object({
  runs: z.array(z.unknown()).nullish(),
  limit: z.number().nullish(),
  hasMore: z.boolean().nullish(),
  recordingAvailable: z.boolean(),
  note: z.string().nullish(),
});

/**
 * The run log, or `null` when the envelope cannot be read.
 *
 * `null` rather than a synthesised `{recordingAvailable: false}`: that value
 * carries a specific meaning — "this build does not record firings" — and
 * inventing it for an unreadable response would state a fact about the build
 * that the response never supplied. Callers render "we could not read it".
 */
export function parseAutomationRunLog(raw: unknown): AutomationRunLog | null {
  const envelope = runLogSchema.safeParse(raw);
  if (!envelope.success) return null;

  const runs: AutomationRun[] = [];
  for (const entry of envelope.data.runs ?? []) {
    const parsed = runSchema.safeParse(entry);
    if (parsed.success) {
      const { steps, unreadable } = parseSteps(parsed.data.steps);
      runs.push({
        ...parsed.data,
        steps,
        unreadableStepCount: unreadable,
        blockedByRuleIds: parsed.data.blockedByRuleIds ?? null,
      });
    }
  }
  return {
    runs,
    limit: envelope.data.limit ?? runs.length,
    hasMore: envelope.data.hasMore ?? false,
    recordingAvailable: envelope.data.recordingAvailable,
    note: envelope.data.note ?? null,
  };
}


// ── Dry run (#2366) ──────────────────────────────────────────────────────────

const factsSchema = z.object({
  subjectKind: z.string(),
  subjectId: z.string(),
  occurredAt: z.string().nullish(),
  sourceConnectionId: z.string().nullish(),
  country: z.string().nullish(),
  totalGross: z.number().nullish(),
  currency: z.string().nullish(),
});

const traceSchema = z.object({
  field: z.string(),
  condition: z.record(z.string(), z.unknown()).nullish(),
  outcome: z.enum(AUTOMATION_CONDITION_OUTCOME_VALUES),
});

const verdictSchema = z.object({
  ruleId: z.string(),
  ruleName: z.string(),
  isSubject: z.boolean(),
  isActive: z.boolean(),
  matches: z.boolean(),
  wouldFire: z.boolean(),
  nonFiringReason: z.enum(AUTOMATION_NON_FIRING_REASON_VALUES).nullish(),
  conditionTraces: z.array(traceSchema).nullish(),
  retroactivityFloorWaived: z.boolean(),
  blockedBy: z
    .object({
      collidingRuleIds: z.array(z.string()),
      actions: z.array(z.string()),
    })
    .nullish(),
  stepAvailability: z.array(availabilityEntrySchema).nullish(),
});

const dryRunSchema = z.object({
  trigger: z.string(),
  facts: factsSchema,
  evaluatedAt: z.string(),
  verdicts: z.array(verdictSchema),
});

/**
 * The dry-run result, parsed ALL-OR-NOTHING.
 *
 * Deliberately unlike the row-level degradation elsewhere in this file. This is
 * the evidence an operator arms a money-spending rule on, and a partially-read
 * verdict list would silently drop the very sibling whose collision the endpoint
 * returns every rule in order to reveal. Throwing routes the panel to its error
 * branch, which says we could not read it — the honest answer.
 */
export function parseAutomationDryRun(raw: unknown): AutomationDryRunResult {
  const parsed = dryRunSchema.parse(raw);
  return {
    trigger: parsed.trigger,
    evaluatedAt: parsed.evaluatedAt,
    facts: {
      ...parsed.facts,
      occurredAt: parsed.facts.occurredAt ?? null,
      sourceConnectionId: parsed.facts.sourceConnectionId ?? null,
      country: parsed.facts.country ?? null,
      totalGross: parsed.facts.totalGross ?? null,
      currency: parsed.facts.currency ?? null,
    },
    verdicts: parsed.verdicts.map((verdict) => ({
      ...verdict,
      nonFiringReason: verdict.nonFiringReason ?? null,
      conditionTraces: (verdict.conditionTraces ?? []).map((trace) => ({
        ...trace,
        condition: trace.condition ?? {},
      })),
      blockedBy: verdict.blockedBy
        ? {
            collidingRuleIds: verdict.blockedBy.collidingRuleIds,
            actions: verdict.blockedBy.actions,
          }
        : null,
      stepAvailability: (verdict.stepAvailability ?? []).map((entry) => ({
        ...entry,
        reason: entry.reason ?? null,
      })),
    })),
  };
}
