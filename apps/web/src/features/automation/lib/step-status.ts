/**
 * Step-status labels (#2366)
 *
 * Exhaustive over the closed union with a `never` check — a fifth status fails
 * the build rather than rendering as a raw code beside four labelled ones.
 *
 * @module apps/web/src/features/automation/lib
 */
import { getMessages } from '../../../shared/i18n';
import type { AutomationStepStatus } from '../api/automation.types';

export function describeStepStatus(status: AutomationStepStatus): string {
  const copy = getMessages('automation').stepStatuses;
  switch (status) {
    case 'done':
      return copy.done;
    case 'nothing-to-do':
      return copy['nothing-to-do'];
    case 'failed':
      return copy.failed;
    case 'skipped':
      return copy.skipped;
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled automation step status: ${String(exhaustive)}`);
    }
  }
}

/** `nothing-to-do` is NOT a failure — it ran and found the work already done. */
export function stepStatusTone(status: AutomationStepStatus): 'success' | 'error' | 'neutral' {
  if (status === 'done') return 'success';
  if (status === 'failed') return 'error';
  return 'neutral';
}
