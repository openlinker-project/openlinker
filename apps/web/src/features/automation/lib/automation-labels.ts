/**
 * Automation labels read outside the feature
 *
 * Four lookups the orders timeline reads from the automation barrel
 * (`AUTOMATION_ACTION_LABELS`, `AUTOMATION_TRIGGER_COPY`,
 * `AUTOMATION_FAILURE_COPY`, `AUTOMATION_RUN_OUTCOME_COPY`). They keep the name
 * and shape they had as copy constants, but every value is a getter that reads
 * the `automation` namespace when it is read, never at module load, so the
 * words follow the active language (ADR-081). A key this build does not know
 * still reads `undefined`, so callers keep their raw-code fallbacks.
 *
 * @module apps/web/src/features/automation/lib
 */
import { formatPlural, getLocale, getMessages, interpolate } from '../../../shared/i18n';
import {
  AUTOMATION_ACTION_VALUES,
  AUTOMATION_RUN_OUTCOME_VALUES,
  AUTOMATION_TRIGGER_VALUES,
} from '../api/automation.types';
import type { AutomationRunOutcome, AutomationTrigger } from '../api/automation.types';

function automationCopy(): ReturnType<typeof getMessages<'automation'>> {
  return getMessages('automation');
}

function getterMap<K extends string, V>(keys: readonly K[], read: (key: K) => V): Record<K, V> {
  const target = {} as Record<K, V>;
  for (const key of keys) {
    Object.defineProperty(target, key, { enumerable: true, get: () => read(key) });
  }
  return target;
}

/** Imperative step names, keyed by action code. */
export const AUTOMATION_ACTION_LABELS: Record<string, string> = getterMap(
  AUTOMATION_ACTION_VALUES,
  (key) => (automationCopy().actions as Record<string, string>)[key] ?? key,
);

/** Each trigger's operator label and one-line description. */
export const AUTOMATION_TRIGGER_COPY: Record<
  AutomationTrigger,
  { readonly label: string; readonly description: string }
> = getterMap(
  AUTOMATION_TRIGGER_VALUES,
  (key) =>
    (automationCopy().triggers as Record<string, { label: string; description: string }>)[key] ?? {
      label: key,
      description: '',
    },
);

/** How a whole firing ended. */
export const AUTOMATION_RUN_OUTCOME_COPY: Record<AutomationRunOutcome, string> = getterMap(
  AUTOMATION_RUN_OUTCOME_VALUES,
  (key) => (automationCopy().runOutcomes as Record<string, string>)[key] ?? key,
);

type FailureCopy = ReturnType<typeof automationCopy>['failure'];
type FailureStrings = {
  readonly [K in keyof FailureCopy as FailureCopy[K] extends string ? K : never]: string;
};

/** The AF-X surfaces' own strings (#2387). */
export const AUTOMATION_FAILURE_COPY: FailureStrings & {
  readonly unknownActionTitle: (action: string, ref: string) => string;
  readonly said: (who: string) => string;
  readonly skippedOne: (step: string) => string;
  readonly skippedMany: (count: number) => string;
} = Object.defineProperties(
  {
    unknownActionTitle: (action: string, ref: string) =>
      interpolate(automationCopy().failure.unknownActionTitle, { action, ref }),
    said: (who: string) => interpolate(automationCopy().failure.said, { who }),
    skippedOne: (step: string) => interpolate(automationCopy().failure.skippedOne, { step }),
    skippedMany: (count: number) =>
      formatPlural(count, automationCopy().failure.skippedMany, getLocale()),
  },
  Object.fromEntries(
    (
      [
        'badge',
        'reasonUnknown',
        'stoppedAfter',
        'retry',
        'retrying',
        'retryFailed',
        'dismiss',
        'dismissing',
        'dismissFailed',
        'dismissed',
        'actionsHeader',
        'attentionFilter',
        'clearAttentionFilter',
        'emptyAttentionTitle',
        'emptyAttentionMessage',
        'isRetryOf',
        'superseded',
      ] as const
    ).map((key) => [
      key,
      { enumerable: true, get: () => automationCopy().failure[key] },
    ]),
  ),
) as never;
