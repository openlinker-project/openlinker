/**
 * Reading an automation write refusal (#2365)
 *
 * `AutomationExceptionFilter` answers with a STRUCTURED body — `error` carries
 * the domain exception's own name, and each refusal carries the facts that name
 * it (`trigger`, `action`, `field`, `index`, `count`/`min`/`max`). Its docblock
 * says why: the eight are separate types "precisely so a caller can tell them
 * apart", and "a renderer that had to parse the copy would drift the first time
 * the wording changed".
 *
 * So this reads FIELDS, never the message string — the `decline-error.ts`
 * precedent, whose own docblock states the same rule.
 *
 * **The `index` is the point.** Three refusals identify WHICH row is wrong, and
 * `frontend-architecture.md` § Form State asks that server errors be mapped back
 * to fields "where practical". An index into a `useFieldArray` is as practical
 * as it gets; discarding it and rendering only a banner throws away the one
 * thing the backend built to be renderable.
 *
 * @module apps/web/src/features/automation/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import { AUTOMATION_COMPOSER_COPY } from './automation.copy';

/** Which field array a refusal points at, when it points at one. */
export type AutomationErrorTarget = 'conditions' | 'actions' | null;

export interface AutomationWriteRefusal {
  /** One sentence for the form-level summary. */
  message: string;
  /** The field array the offending row lives in, or null for a rule-level refusal. */
  target: AutomationErrorTarget;
  /** Index of the offending row within `target`, or null. */
  index: number | null;
  /** True for the duplicate-rule conflict, which has its own remediation. */
  isDuplicate: boolean;
}

function readString(details: unknown, key: string): string | null {
  if (typeof details !== 'object' || details === null || !(key in details)) return null;
  const value: unknown = (details as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readIndex(details: unknown): number | null {
  if (typeof details !== 'object' || details === null || !('index' in details)) return null;
  const value: unknown = (details as Record<string, unknown>).index;
  // A negative or fractional index is not a row reference; treat it as absent
  // rather than calling `setError` on a path that does not exist.
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Describe a failed create/replace.
 *
 * Falls back to the raw message for anything this build does not recognise —
 * a refusal added backend-side must still reach the operator, and a generic
 * "something went wrong" would hide a sentence that already explains itself.
 */
export function describeAutomationWriteError(error: unknown): AutomationWriteRefusal {
  if (!(error instanceof ApiError)) {
    const message =
      error instanceof Error && error.message.length > 0
        ? error.message
        : AUTOMATION_COMPOSER_COPY.saveFailedGeneric;
    return { message, target: null, index: null, isDuplicate: false };
  }

  const name = readString(error.details, 'error');
  const index = readIndex(error.details);

  switch (name) {
    case 'AutomationRuleConflictError':
      return {
        message: AUTOMATION_COMPOSER_COPY.duplicateRule,
        target: null,
        index: null,
        isDuplicate: true,
      };
    case 'AutomationIllegalPairError': {
      // Both facts come off the body; the sentence is ours so it can name the
      // remediation the backend has no opinion about.
      const action = readString(error.details, 'action');
      return {
        message:
          action === null
            ? error.message
            : AUTOMATION_COMPOSER_COPY.illegalPair(action),
        target: 'actions',
        index,
        isDuplicate: false,
      };
    }
    case 'AutomationInvalidActionError':
      return { message: error.message, target: 'actions', index, isDuplicate: false };
    case 'AutomationIllegalConditionFieldError':
    case 'AutomationInvalidConditionError':
      return { message: error.message, target: 'conditions', index, isDuplicate: false };
    case 'AutomationStepCountError':
      return { message: error.message, target: 'actions', index: null, isDuplicate: false };
    default:
      return {
        message:
          error.message.length > 0 ? error.message : AUTOMATION_COMPOSER_COPY.saveFailedGeneric,
        target: null,
        index: null,
        isDuplicate: false,
      };
  }
}
