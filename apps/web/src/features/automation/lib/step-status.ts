/**
 * Step-status labels (#2366)
 *
 * Exhaustive over the closed union with a `never` check — a fifth status fails
 * the build rather than rendering as a raw code beside four labelled ones.
 *
 * @module apps/web/src/features/automation/lib
 */
import { AUTOMATION_STEP_STATUS_COPY } from './automation.copy';
import type { AutomationStepStatus } from '../api/automation.types';

export function describeStepStatus(status: AutomationStepStatus): string {
  switch (status) {
    case 'done':
      return AUTOMATION_STEP_STATUS_COPY.done;
    case 'nothing-to-do':
      return AUTOMATION_STEP_STATUS_COPY['nothing-to-do'];
    case 'failed':
      return AUTOMATION_STEP_STATUS_COPY.failed;
    case 'skipped':
      return AUTOMATION_STEP_STATUS_COPY.skipped;
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
