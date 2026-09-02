/**
 * Automation firings as order-timeline events (#2385, spec §5.6 b)
 *
 * ## A rendering, not a second write
 *
 * There is no timeline table anywhere in the repo — `OrderActivityTimeline`
 * derives every event it shows. So this is the fourth of §5.6's "four readings"
 * of one `automation_runs` row, not a second persisted artefact. The AC says it
 * plainly: *"no surface has its own write path"*.
 *
 * ## One event per STEP, and the skipped step is one of them
 *
 * A two-step rule writes two events, in order. A failed step additionally emits
 * one `Skipped: …` event naming what did not run — because a silently missing
 * step is indistinguishable from one that was never configured, which is the
 * whole reason the backend records `skipped` at all rather than omitting it.
 *
 * ## Two forced deviations from spec §5.6(b)'s field mapping, both stated
 *
 * The spec says `by` is `Automation · {rule name}` **with the name linking to
 * the rule**. Two constraints make that impossible as written, and neither is
 * discoverable from the code alone:
 *
 * 1. `TimelineEvent.by` is typed `string` on the shared timeline, so it cannot
 *    carry an anchor. Widening it to `ReactNode` is the change if the spec's
 *    literal shape is ever wanted.
 * 2. **There is no per-rule route.** `/automations/:trigger` lists the rules on
 *    a trigger; nothing addresses one rule directly.
 *
 * So the link rides on the FOOTER (the trigger sentence, which is what it
 * actually points at) and `by` stays plain text. S3-8 still holds — the operator
 * reaches the rule from the order in one click — but via the trigger page rather
 * than the rule itself.
 *
 * ## The copy comes from `features/automation`, deliberately
 *
 * `AUTOMATION_ACTION_LABELS` / `AUTOMATION_TRIGGER_COPY` are imported from that
 * feature's public barrel rather than re-declared here. Two reasons, and the
 * second is easy to lose: a local copy would drift from the composer, and
 * `check-ui-vocabulary` scans `features/automation` and **not**
 * `features/orders` — so operator copy declared on this side would sit outside
 * the gate entirely.
 *
 * @module apps/web/src/features/orders/lib
 */
import {
  automationFailureTitle,
  stepReasonText,
  AUTOMATION_ACTION_LABELS,
  AUTOMATION_TRIGGER_COPY,
  type AutomationRun,
  type AutomationStepResult,
} from '../../automation';

/** The subset of the timeline's own event shape this module produces. */
export interface AutomationTimelineEvent {
  id: string;
  timestamp: string;
  title: string;
  /** `Automation · {rule name}` — the name is the rule that fired, frozen at write time. */
  by: string;
  description?: string;
  footer: string;
  tone: 'default' | 'error';
  /** This firing re-ran an earlier failure (#2387). */
  isRetry?: boolean;
  /** An operator recorded that they handled this failure themselves (#2387). */
  handledByOperator?: boolean;
  /** The run's overall outcome, on exactly one event per run (`stepIndex === 0`). */
  runOutcome?: string;
  /** The rule this step belongs to. */
  ruleId: string;
  /**
   * The trigger, which is what `/automations/:trigger` is keyed on — the route
   * that gets an operator from the order to the rule they can switch off (S3-6),
   * without already knowing which rule to suspect.
   */
  trigger: string;
}

/**
 * Past-tense verbs, spec §5.6 (b).
 *
 * Distinct from `AUTOMATION_ACTION_LABELS`, which are imperative because the
 * composer offers them as choices. A timeline reports what already happened, so
 * "Buy the shipping label" would be the wrong tense in the one place the
 * operator is reading history.
 */
const ACTION_PAST_TENSE: Record<string, string> = {
  'issue-sales-document': 'Issued the sales document',
  'dispatch-shipment': 'Bought the shipping label',
  'relay-status-to-source': 'Told the marketplace the order shipped',
  'send-email': 'Sent an email',
  'place-hold': 'Put the order on hold',
  'release-hold': 'Lifted the hold',
};

export const AUTOMATION_TIMELINE_COPY = {
  byPrefix: 'Automation',
  ranBecause: 'Ran because:',
  stoppedAfterFailure: 'The automation stopped after the step that failed.',
  skippedPrefix: 'Skipped:',
  nothingToDoSuffix: 'nothing to do',
} as const;

function actionTitle(action: string): string {
  return ACTION_PAST_TENSE[action] ?? AUTOMATION_ACTION_LABELS[action] ?? action;
}

function triggerName(trigger: string): string {
  return (
    (AUTOMATION_TRIGGER_COPY as Record<string, { label: string } | undefined>)[trigger]?.label ??
    trigger
  );
}

function isStepResult(step: unknown): step is AutomationStepResult {
  return (
    typeof step === 'object' &&
    step !== null &&
    typeof (step as { action?: unknown }).action === 'string' &&
    typeof (step as { status?: unknown }).status === 'string'
  );
}

/**
 * Derive the timeline events for one order's automation firings.
 *
 * **Firings only.** The input is `automation_runs` rows, and a rule that
 * evaluated without matching never produces one — so an order matching no rule
 * contributes nothing, rather than one line per rule per event forever. That
 * property is structural: it comes from what the backend writes, not from a
 * filter here that could be forgotten.
 */
export function buildAutomationTimelineEvents(
  runs: readonly AutomationRun[],
): AutomationTimelineEvent[] {
  const events: AutomationTimelineEvent[] = [];

  for (const run of runs) {
    const by = `${AUTOMATION_TIMELINE_COPY.byPrefix} · ${run.ruleName}`;
    const footer = `${AUTOMATION_TIMELINE_COPY.ranBecause} ${triggerName(run.trigger)}`;
    const steps = run.steps.filter(isStepResult);

    for (const step of steps) {
      if (step.status === 'skipped') {
        // The §5.6(b) "Skipped: …" event. Emitted from the recorded step rather
        // than inferred from the failure, so a step that never ran is visible
        // instead of merely absent.
        events.push({
          id: `${run.id}:${step.stepIndex}:skipped`,
          timestamp: run.firedAt,
          title: `${AUTOMATION_TIMELINE_COPY.skippedPrefix} ${actionTitle(step.action).toLowerCase()}`,
          by,
          footer: AUTOMATION_TIMELINE_COPY.stoppedAfterFailure,
          tone: 'default',
          ruleId: run.ruleId,
          trigger: run.trigger,
          runOutcome: step.stepIndex === 0 ? run.outcome : undefined,
        });
        continue;
      }

      const failed = step.status === 'failed';
      events.push({
        id: `${run.id}:${step.stepIndex}`,
        timestamp: run.firedAt,
        // A FAILED step takes the action's own verb — "Couldn't buy the label
        // for order X" (#2387) — rather than the neutral past tense a
        // succeeded step gets. "An automation failed" tells an operator nothing
        // about what to do next, and the six fixes are six different errands.
        title: failed
          ? automationFailureTitle(step.action, run.subjectId)
          : actionTitle(step.action),
        // The RUN-level outcome, on one event per run — a run-level fact
        // repeated per step would state N times something true once.
        //
        // Anchored to `stepIndex === 0`, a property of the DATA. "The first
        // event emitted" would be fragile: every event of one run shares
        // `run.firedAt`, so their order after the timeline's chronological sort
        // is insertion order, and any future re-sort would move the label.
        runOutcome: step.stepIndex === 0 ? run.outcome : undefined,
        by,
        // The operation's OWN words, attributed, where something reported
        // (#2387) — `stepReasonText` prefers `report` over `detail`, because
        // `detail` is OpenLinker's sentence ABOUT the failure and `report` is
        // the failure's own. Never paraphrased into operator-friendlier
        // wording that loses the reason.
        description:
          stepReasonText(step) ??
          step.unavailableReason ??
          (step.status === 'nothing-to-do'
            ? AUTOMATION_TIMELINE_COPY.nothingToDoSuffix
            : undefined),
        footer,
        tone: failed ? 'error' : 'default',
        ruleId: run.ruleId,
        trigger: run.trigger,
        // A retry chain reads as one story. Without this the operator sees two
        // unrelated firings and has to correlate them by timestamp (#2387).
        isRetry: run.retryOfRunId !== null,
        // Dismissal says a PERSON dealt with it — never that this run
        // succeeded. Both entries stay in the timeline permanently; only the
        // attention state clears.
        handledByOperator: run.dismissedAt !== null,
      });
    }
  }

  return events;
}
