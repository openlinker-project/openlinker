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
  AUTOMATION_FIRING_MODE_VALUES,
  AUTOMATION_TRIGGER_VALUES,
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

const runSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  ruleName: z.string(),
  trigger: z.string(),
  subjectKind: z.string(),
  subjectId: z.string(),
  outcome: z.string(),
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
      runs.push({ ...parsed.data, blockedByRuleIds: parsed.data.blockedByRuleIds ?? null });
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
