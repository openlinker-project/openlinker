/**
 * Reading an automation write refusal (#2365)
 *
 * `AutomationExceptionFilter` answers with a STRUCTURED body - a stable `code`
 * per refusal (#3863), and `params` carrying the facts that name it
 * (`trigger`, `action`, `field`, `index`, `count`/`min`/`max`). Its docblock
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
import { describeApiError } from '../../../shared/api/describe-api-error';
import { getMessages, interpolate } from '../../../shared/i18n';
import type { ApiErrorParams } from '../../../shared/api/api-error.types';

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

function readString(params: ApiErrorParams, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readIndex(params: ApiErrorParams): number | null {
  const value = params.index;
  // A negative or fractional index is not a row reference; treat it as absent
  // rather than calling `setError` on a path that does not exist.
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Describe a failed create/replace.
 *
 * A refusal this build does not recognise still reads through
 * `describeApiError`, so a code added backend-side reaches the operator in
 * their language.
 */
export function describeAutomationWriteError(error: unknown): AutomationWriteRefusal {
  const copy = getMessages('automation').composer;
  const message = describeApiError(error, 'automation');
  if (!(error instanceof ApiError)) {
    return { message, target: null, index: null, isDuplicate: false };
  }

  const index = readIndex(error.params);

  switch (error.code) {
    case 'AUTOMATION_RULE_CONFLICT':
      return {
        message: copy.duplicateRule,
        target: null,
        index: null,
        isDuplicate: true,
      };
    case 'AUTOMATION_TRIGGER_ACTION_ILLEGAL': {
      // The sentence is ours so it can name the remediation the backend has
      // no opinion about.
      const action = readString(error.params, 'action');
      return {
        message: action === null ? message : interpolate(copy.illegalPair, { action }),
        target: 'actions',
        index,
        isDuplicate: false,
      };
    }
    case 'AUTOMATION_ACTION_INVALID':
      return { message, target: 'actions', index, isDuplicate: false };
    case 'AUTOMATION_CONDITION_FIELD_ILLEGAL':
    case 'AUTOMATION_CONDITION_INVALID':
      return { message, target: 'conditions', index, isDuplicate: false };
    case 'AUTOMATION_STEP_COUNT_INVALID':
      return { message, target: 'actions', index: null, isDuplicate: false };
    default:
      return { message, target: null, index: null, isDuplicate: false };
  }
}
