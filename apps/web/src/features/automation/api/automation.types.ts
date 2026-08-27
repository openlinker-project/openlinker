/**
 * Automation Types (#2364)
 *
 * The view-model surface of the #2363 automation API, plus locally-declared
 * copies of the backend's closed unions.
 *
 * **The unions are re-declared, not imported.** `apps/web` has no
 * `@openlinker/*` dependency (#591), so the browser bundle cannot reach
 * `@openlinker/core/automation`. They are copies by necessity — which is why
 * nothing in this feature ever *decides* anything from them: the legality
 * matrix, the per-action availability and the per-rule step availability all
 * arrive from `GET /automations/vocabulary` and the rule responses. These
 * arrays exist to parse and to render in a stable order, never to be the
 * source of truth for what a trigger may do.
 *
 * @module apps/web/src/features/automation/api
 */

/** The eight v1 triggers, in the backend's own declaration order. */
export const AUTOMATION_TRIGGER_VALUES = [
  'order.hold.placed',
  'order.hold.released',
  'order.on_hold_for',
  'order.dispatch_deadline_near',
  'order.packed',
  'return.received',
  'return.disposed',
  'inventory.reservation_shortfall',
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGER_VALUES)[number];

export function isAutomationTrigger(value: unknown): value is AutomationTrigger {
  return (
    typeof value === 'string' &&
    (AUTOMATION_TRIGGER_VALUES as readonly string[]).includes(value)
  );
}

/** The six v1 actions. Only one of them can actually run — see `AutomationActionAvailability`. */
export const AUTOMATION_ACTION_VALUES = [
  'issue-sales-document',
  'dispatch-shipment',
  'relay-status-to-source',
  'send-email',
  'place-hold',
  'release-hold',
] as const;
export type AutomationActionKind = (typeof AUTOMATION_ACTION_VALUES)[number];

/**
 * How reachable an action's underlying operation is in this build.
 *
 * Three-valued because the truth is three-valued: `send-email` genuinely works
 * from the API process and genuinely does not from the background worker, so
 * neither `available` nor `unavailable` describes it.
 */
export const AUTOMATION_ACTION_AVAILABILITY_VALUES = [
  'available',
  'partial',
  'unavailable',
] as const;
export type AutomationActionAvailability =
  (typeof AUTOMATION_ACTION_AVAILABILITY_VALUES)[number];

/** How a trigger fires: on a write, or on a clock crossing. */
export const AUTOMATION_FIRING_MODE_VALUES = ['edge', 'deadline-sweep'] as const;
export type AutomationFiringMode = (typeof AUTOMATION_FIRING_MODE_VALUES)[number];

/**
 * One action's availability in this build.
 *
 * `reason` is the BACKEND's own string and is rendered verbatim wherever it is
 * shown. Paraphrasing it would recreate the drift the backend's own
 * `AUTOMATION_ACTION_AVAILABILITY` docblock exists to prevent — an operator who
 * reads one sentence in the composer and a different one on a failed run cannot
 * tell which is lying. Note that because these strings arrive at runtime they
 * are outside `check-ui-vocabulary`'s reach; only this feature's own labels are
 * scanned.
 */
export interface AutomationActionAvailabilityEntry {
  action: string;
  availability: AutomationActionAvailability;
  reason: string | null;
}

export interface AutomationActionVocabulary extends AutomationActionAvailabilityEntry {
  /** Obeys the at-most-one rule when several rules match the same subject. */
  irreversible: boolean;
}

export interface AutomationTriggerVocabulary {
  value: AutomationTrigger;
  firingMode: AutomationFiringMode;
  /** The single `triggerConfig` key this trigger takes, or null for the parameterless six. */
  configKey: string | null;
  legalActions: string[];
  legalConditionFields: string[];
}

export interface AutomationVocabulary {
  triggers: AutomationTriggerVocabulary[];
  actions: AutomationActionVocabulary[];
  conditionFields: string[];
  amountOps: string[];
  holdReasons: string[];
  stepBounds: { min: number; max: number };
  runOutcomes: string[];
  stepStatuses: string[];
  nonFiringReasons: string[];
  conditionOutcomes: string[];
}

export interface AutomationTriggerSummary {
  trigger: AutomationTrigger;
  ruleCount: number;
}

/**
 * One saved rule.
 *
 * `actionAvailability` is the field that makes this projection worth having: it
 * rides on EVERY rule response, so a rule the operator just saved carries, in
 * its own step order, whether each step can actually run. The write path
 * deliberately accepts all six actions, which is exactly why the response is
 * where an operator learns that the rule they armed can do nothing yet.
 */
export interface AutomationRule {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  triggerConfig: Record<string, unknown>;
  conditions: unknown[];
  actions: unknown[];
  definitionHash: string;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  hasIrreversibleAction: boolean;
  actionAvailability: AutomationActionAvailabilityEntry[];
  moneyAckByUserId: string | null;
  moneyAckAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The per-rule fired log.
 *
 * `recordingAvailable` is not decoration. While it is `false`, an empty `runs`
 * says NOTHING about whether the rule fired — the run write path has not
 * landed. Treating the two as the same is how an operator concludes a working
 * rule is broken, so every consumer must branch on it before reading `runs`.
 */
export interface AutomationRunLog {
  runs: AutomationRun[];
  limit: number;
  hasMore: boolean;
  recordingAvailable: boolean;
  note: string | null;
}

export interface AutomationRun {
  id: string;
  ruleId: string;
  ruleName: string;
  trigger: string;
  subjectKind: string;
  subjectId: string;
  outcome: string;
  blockedByRuleIds: string[] | null;
  firedAt: string;
}

/** The four v1 condition fields (spec §5.5 divergence 2). */
export const AUTOMATION_CONDITION_FIELD_VALUES = [
  'sourceConnection',
  'orderCountry',
  'orderTotalGross',
  'holdReason',
] as const;
export type AutomationConditionField = (typeof AUTOMATION_CONDITION_FIELD_VALUES)[number];

/** Comparison operators an amount condition may use. Never inferred. */
export const AUTOMATION_AMOUNT_OP_VALUES = ['gte', 'lt'] as const;
export type AutomationAmountOp = (typeof AUTOMATION_AMOUNT_OP_VALUES)[number];

/**
 * The nine merge fields, spec §5.3b — a CLOSED list.
 *
 * An open templating surface is a scripting language, which §6 refuses. An
 * unrecognised `{…}` is rendered VERBATIM as typed, never blanked: blanking
 * silently produces an email that reads as broken, whereas a visible
 * `{ordr.reference}` is a typo the operator can see and fix.
 */
export const AUTOMATION_MERGE_FIELDS = [
  { token: '{order.reference}', renders: "the order's operator-facing reference" },
  { token: '{order.source}', renders: 'the channel name' },
  { token: '{order.total}', renders: 'the gross total with its currency' },
  { token: '{order.placedAt}', renders: "the order date, in the operator's locale" },
  { token: '{order.dispatchBy}', renders: 'the marketplace dispatch deadline, or "no deadline"' },
  { token: '{buyer.name}', renders: "the buyer's name as the source reported it" },
  { token: '{shipment.tracking}', renders: 'the tracking number, or "not yet"' },
  { token: '{hold.reason}', renders: "the current hold's reason, or \"no hold\"" },
  { token: '{rule.name}', renders: "the automation's own name" },
] as const;

/**
 * The capability a connection must carry to appear in A2's carrier select.
 *
 * A MANIFEST capability, not a `CoreCapabilityValues` member — capability is
 * open at the registry boundary (#576). The plausible-looking
 * `'ShippingProvider'` is asserted NOT to be a core capability in
 * `adapter.types.spec.ts`; naming it wrong renders an empty select that reads
 * as "you have no carriers configured".
 */
export const AUTOMATION_CARRIER_CAPABILITY = 'ShippingProviderManager';

/**
 * The complete definition a write must carry.
 *
 * ONE type for both `POST /automations` and `PUT /automations/:id`, because the
 * backend takes the same body for both: `updateRule` re-validates and re-hashes
 * a COMPLETE input, which is exactly why that route is a `PUT` and not a
 * `PATCH`. A separate create type would imply a difference that does not exist.
 */
export interface AutomationRuleWriteInput {
  name: string;
  trigger: AutomationTrigger;
  triggerConfig: Record<string, unknown>;
  conditions: unknown[];
  actions: unknown[];
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  moneyAcknowledged?: boolean;
}
