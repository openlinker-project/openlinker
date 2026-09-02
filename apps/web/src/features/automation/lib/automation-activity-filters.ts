/**
 * Activity-log URL filters (#2386)
 *
 * Mirrors `returns-filters.ts` — the repo's filter convention — with the same
 * seven functions and the same offset-reset rule.
 *
 * ## An unrecognised value is IGNORED, never thrown
 *
 * A URL is operator-editable, and a shared link outliving a vocabulary change
 * must degrade to a wider view rather than a crash. Every filter here is a
 * NARROWING one, so ignoring a value the operator mistyped shows them MORE than
 * they asked for — visible, and recoverable by fixing the URL.
 *
 * That is the opposite of how the backend treats a SUBJECT SCOPE, and the
 * asymmetry is deliberate: a scope it cannot honour would return other
 * subjects' rows, which an operator cannot detect by looking, so the API throws.
 * Because this module coerces before anything is sent, the API's rule is
 * defence-in-depth rather than the path an operator normally travels.
 *
 * @module apps/web/src/features/automation/lib
 */
import {
  AUTOMATION_RUN_OUTCOME_VALUES,
  AUTOMATION_TRIGGER_VALUES,
  type AutomationRunOutcome,
  type AutomationTrigger,
} from '../api/automation.types';

export const AUTOMATION_ACTIVITY_FILTER_PARAMS = [
  'ruleId',
  'trigger',
  'outcome',
  'from',
  'to',
  'orderId',
  // Included so "Clear filters" clears it too — an attention filter left
  // standing after a clear is how an empty table reads as "nothing happened".
  'attentionOnly',
] as const;

export const AUTOMATION_ACTIVITY_OFFSET_PARAM = 'offset';

export interface AutomationActivityFilters {
  /**
   * Narrow to firings that need attention (#2387). Absent means "do not narrow";
   * there is deliberately no `false` meaning "only the routine ones", because no
   * surface asks that and a second meaning would be a second vocabulary.
   */
  attentionOnly?: boolean;
  ruleId?: string;
  trigger?: AutomationTrigger;
  outcome?: AutomationRunOutcome;
  from?: string;
  to?: string;
  orderId?: string;
}

function isTrigger(value: string | null): value is AutomationTrigger {
  return value !== null && (AUTOMATION_TRIGGER_VALUES as readonly string[]).includes(value);
}

function isOutcome(value: string | null): value is AutomationRunOutcome {
  return value !== null && (AUTOMATION_RUN_OUTCOME_VALUES as readonly string[]).includes(value);
}

/**
 * An ISO instant, or `undefined` for anything unparseable.
 *
 * There is no `is*` guard for a date, so without this `from=banana` has no
 * handler at all — it would reach the API as an `Invalid Date` that either
 * throws at the query layer or silently matches nothing. Both would break the
 * ignore-never-throw rule this module exists to keep.
 */
export function readIsoDateParam(value: string | null): string | undefined {
  if (value === null || value.length === 0) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : value;
}

/** Read the filters out of the URL, narrowing every raw value. */
export function readAutomationActivityFilters(
  params: URLSearchParams,
): AutomationActivityFilters {
  const trigger = params.get('trigger');
  const outcome = params.get('outcome');
  const ruleId = params.get('ruleId');
  const orderId = params.get('orderId');

  return {
    ruleId: ruleId === null || ruleId.length === 0 ? undefined : ruleId,
    trigger: isTrigger(trigger) ? trigger : undefined,
    outcome: isOutcome(outcome) ? outcome : undefined,
    from: readIsoDateParam(params.get('from')),
    to: readIsoDateParam(params.get('to')),
    orderId: orderId === null || orderId.length === 0 ? undefined : orderId,
    // Only the literal `true` narrows (#2387), matching the API. Anything else
    // — including `false` — reads as absent, because there is no "only the
    // routine ones" question and a second meaning would be a second vocabulary.
    attentionOnly: params.get('attentionOnly') === 'true' ? true : undefined,
  };
}

export function readAutomationActivityOffset(params: URLSearchParams): number {
  const raw = Number(params.get(AUTOMATION_ACTIVITY_OFFSET_PARAM) ?? '0');
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

export function hasActiveAutomationActivityFilters(
  filters: AutomationActivityFilters,
): boolean {
  return Object.values(filters).some((value) => value !== undefined);
}

/**
 * Set one filter, dropping the offset.
 *
 * Narrowing while staying on page 4 lands the operator on an arbitrary page —
 * usually an empty one, which reads as "no results" rather than "you are past
 * the end".
 */
export function setAutomationActivityFilterParam(
  params: URLSearchParams,
  key: (typeof AUTOMATION_ACTIVITY_FILTER_PARAMS)[number],
  value: string,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  next.delete(AUTOMATION_ACTIVITY_OFFSET_PARAM);
  return next;
}

/** Drop every filter param (and the offset) in one call. */
export function clearAutomationActivityFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of AUTOMATION_ACTIVITY_FILTER_PARAMS) next.delete(key);
  next.delete(AUTOMATION_ACTIVITY_OFFSET_PARAM);
  return next;
}

export function setAutomationActivityOffsetParam(
  params: URLSearchParams,
  offset: number,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (offset <= 0) next.delete(AUTOMATION_ACTIVITY_OFFSET_PARAM);
  else next.set(AUTOMATION_ACTIVITY_OFFSET_PARAM, String(offset));
  return next;
}
