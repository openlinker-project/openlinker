/**
 * Action availability — the rule (#2364)
 *
 * The single place this feature turns a declared availability into something an
 * operator reads. Two consumers — the index's availability panel and the
 * per-rule warning on a rule row — so what the panel says about an action and
 * what a rule row says about the same action cannot drift.
 *
 * ## The split: label is ours, explanation is theirs
 *
 * `label` is frontend copy (three fixed strings, scanned by the vocabulary
 * gate). `reason` is the BACKEND's own sentence, rendered verbatim and never
 * paraphrased. That is not fussiness: `AUTOMATION_ACTION_AVAILABILITY`'s own
 * docblock records why one table feeds the executors and the vocabulary
 * endpoint together — *"a composer that says 'not built yet' and an executor
 * that says something else about the same action is worse than either alone,
 * because the operator cannot tell which one is lying"*. A paraphrase here
 * would reintroduce exactly that.
 *
 * The consequence, stated rather than hidden: those strings arrive at runtime,
 * so they are outside `check-ui-vocabulary`'s reach. Only our three labels are
 * scanned.
 *
 * @module apps/web/src/features/automation/lib
 */
import { AUTOMATION_AVAILABILITY_COPY } from './automation.copy';
import type {
  AutomationActionAvailability,
  AutomationActionAvailabilityEntry,
} from '../api/automation.types';

/** `StatusBadge` tones, mapped so severity reads the same on every surface. */
export type AvailabilityTone = 'success' | 'warning' | 'error';

export interface AvailabilityDescription {
  label: string;
  tone: AvailabilityTone;
  /** True where the action can do nothing at all — the case a rule row must warn about. */
  blocking: boolean;
}

/**
 * Describe one availability value.
 *
 * An explicit `switch` with a `never` check rather than a lookup object: a
 * seventh value added backend-side must fail the build here, and a map with a
 * fallback arm would instead render the new value as whatever the fallback
 * says. There is no `otherwise` arm for the same reason — its totality would
 * rest on an invariant `apps/web` cannot import (#591).
 */
export function describeAvailability(
  availability: AutomationActionAvailability,
): AvailabilityDescription {
  switch (availability) {
    case 'available':
      return { label: AUTOMATION_AVAILABILITY_COPY.available, tone: 'success', blocking: false };
    case 'partial':
      return { label: AUTOMATION_AVAILABILITY_COPY.partial, tone: 'warning', blocking: false };
    case 'unavailable':
      return { label: AUTOMATION_AVAILABILITY_COPY.unavailable, tone: 'error', blocking: true };
    default: {
      const exhaustive: never = availability;
      throw new Error(`Unhandled automation action availability: ${String(exhaustive)}`);
    }
  }
}

export interface RuleAvailabilityVerdict {
  /** Steps that cannot run at all. Non-empty ⇒ the rule can do nothing when it fires. */
  blocked: AutomationActionAvailabilityEntry[];
  /** Steps that run only in some firing processes. */
  partial: AutomationActionAvailabilityEntry[];
  /** True when at least one step cannot act — the headline an operator needs. */
  cannotAct: boolean;
}

/**
 * Read a saved rule's own per-step availability.
 *
 * Takes `actionAvailability` off the rule response rather than re-deriving it
 * from the vocabulary by action name. The response is authoritative about THIS
 * rule's steps — including a step naming an action this build does not
 * recognise, which the backend reports as `unavailable` with a reason saying
 * exactly that. Re-deriving would silently drop that case.
 */
export function readRuleAvailability(
  actionAvailability: readonly AutomationActionAvailabilityEntry[],
): RuleAvailabilityVerdict {
  const blocked = actionAvailability.filter((entry) => entry.availability === 'unavailable');
  const partial = actionAvailability.filter((entry) => entry.availability === 'partial');
  return { blocked, partial, cannotAct: blocked.length > 0 };
}
