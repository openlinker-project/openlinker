/**
 * AF-X presentation (#2387, Wave-2 spec §4.2)
 *
 * Turns one failed run into the three strings both surfaces render — the order
 * timeline and `/automations/activity`. ONE module, because a failure that reads
 * one way in the timeline and another in the activity list is the same defect
 * §5.6's "one record, four readings" exists to prevent, one layer up.
 *
 * **Nothing here derives WHETHER a run needs attention.** That is
 * `AutomationRun.needsAttention`, computed server-side, because the rule needs
 * to know whether a *different* row retried this one — a fact no single row can
 * answer about itself. Re-deriving it here would be the second copy the
 * projection exists to prevent. Same for `retryable`.
 *
 * @module features/automation/lib
 */
import {
  AUTOMATION_FAILURE_COPY,
  AUTOMATION_FAILURE_TITLE,
  RETRY_REFUSAL_COPY,
} from './automation.copy';
import type { AutomationRun, AutomationStepResult } from '../api/automation.types';

/** The one string an operator reads first: what could not be done, to which order. */
export function automationFailureTitle(action: string, subjectRef: string): string {
  const build = (AUTOMATION_FAILURE_TITLE as Record<string, ((ref: string) => string) | undefined>)[
    action
  ];
  // Raw-code fallback: an action from a newer backend still says something TRUE
  // (naming its code) rather than nothing, or a wrong verb borrowed from a
  // neighbour.
  return build ? build(subjectRef) : AUTOMATION_FAILURE_COPY.unknownActionTitle(action, subjectRef);
}

/** Why `Try again` is not offered. An unrecognised code renders as itself. */
export function retryRefusalCopy(reason: string | null): string | null {
  if (reason === null) return null;
  return (RETRY_REFUSAL_COPY as Record<string, string | undefined>)[reason] ?? reason;
}

/**
 * The reason a step gave, ATTRIBUTED and verbatim where one was reported.
 *
 * `report` wins over `detail`: `detail` is OpenLinker's sentence *about* the
 * failure, `report` is the failure's own words plus who said them. An operator
 * quoting a marketplace refusal in a support ticket needs the second. When
 * nothing reported, `detail` is still rendered — it is the only thing there.
 */
export function stepReasonText(step: AutomationStepResult): string | null {
  if (step.report !== null) {
    return `${AUTOMATION_FAILURE_COPY.said(step.report.attributedTo)} ${step.report.message}`;
  }
  return step.detail;
}

export interface AutomationFailureView {
  /** The failing step, or `null` for a failed run whose steps we could not read. */
  readonly step: AutomationStepResult | null;
  readonly title: string;
  readonly reason: string;
  /** What did not run after the failure. `null` when nothing was skipped. */
  readonly skipped: string | null;
}

/**
 * Project a failed run into what the two surfaces render.
 *
 * Returns `null` for a run that did not fail — the caller asks about failures,
 * and answering with an empty shape would invite rendering a failure banner over
 * a successful firing.
 *
 * **The skipped steps are named, not counted away.** §5.6 requires the surfaces
 * to state what did NOT run: a silently missing step is indistinguishable from
 * one that was never configured, and "nothing else ran" is exactly the fact that
 * tells an operator the marketplace was never told.
 */
export function buildAutomationFailureView(
  run: AutomationRun,
  actionLabel: (action: string) => string
): AutomationFailureView | null {
  if (run.outcome !== 'failed') return null;

  const step = run.steps.find((entry) => entry.status === 'failed') ?? null;
  const skippedSteps = run.steps.filter((entry) => entry.status === 'skipped');

  const skipped =
    skippedSteps.length === 0
      ? null
      : skippedSteps.length === 1 && skippedSteps[0] !== undefined
        ? `${AUTOMATION_FAILURE_COPY.stoppedAfter} ${AUTOMATION_FAILURE_COPY.skippedOne(
            actionLabel(skippedSteps[0].action).toLowerCase()
          )}`
        : `${AUTOMATION_FAILURE_COPY.stoppedAfter} ${AUTOMATION_FAILURE_COPY.skippedMany(
            skippedSteps.length
          )}`;

  return {
    step,
    title:
      step === null
        ? AUTOMATION_FAILURE_COPY.unknownActionTitle(run.ruleName, run.subjectId)
        : automationFailureTitle(step.action, run.subjectId),
    // A failed run with no readable failed step is a real state (#2385 counts
    // unreadable steps rather than dropping them) — say so instead of rendering
    // an empty line that reads as "no reason, therefore no problem".
    reason:
      step === null
        ? AUTOMATION_FAILURE_COPY.reasonUnknown
        : (stepReasonText(step) ?? AUTOMATION_FAILURE_COPY.reasonUnknown),
    skipped,
  };
}
