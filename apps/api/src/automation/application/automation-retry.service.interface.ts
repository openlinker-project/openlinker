/**
 * Automation Retry Service Interface (#2387, Wave-2 spec §4.2 AF-X row)
 *
 * Re-runs ONE failed firing's rule against ONE order, and nothing else.
 *
 * @module apps/api/src/automation/application
 */
import type { AutomationRunView } from '@openlinker/core/automation';

export interface AutomationRetryInput {
  readonly runId: string;
}

export interface IAutomationRetryService {
  /**
   * Re-run the rule of a failed firing against its own subject.
   *
   * Returns the ORIGINAL run, re-projected — so the caller immediately sees the
   * attention state clear when the retry succeeded, without a second read and
   * without the frontend deriving anything.
   */
  retry(input: AutomationRetryInput): Promise<AutomationRunView>;
}
