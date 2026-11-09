/**
 * What one rule has actually done (#2366, spec §5.6)
 *
 * ## `recordingAvailable` is read FIRST, and it is not decoration
 *
 * While it is false an empty list means "the run write path (#2385) has not
 * landed", NOT "this rule never fired". Rendering an empty-state there would
 * make a working rule look broken, which is the ambiguity the flag exists to
 * remove. So the backend's own `note` leads, and no empty-state is shown.
 *
 * ## Failures carry their reason, and a skipped step is rendered
 *
 * `detail` and `unavailableReason` are the backend's sentences, verbatim.
 * `unavailableReason` is kept distinct from a failure: "not built yet" and "it
 * failed" lead to entirely different investigations. A `skipped` step renders
 * explicitly — a silently missing step is indistinguishable from one that was
 * never configured.
 *
 * ## Fetched lazily, per rule
 *
 * The query is per-rule, so mounting one per row would issue N requests on page
 * load for a log that is empty in this build. It runs only while the row is
 * expanded.
 *
 * @module apps/web/src/features/automation/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../../../shared/ui/alert';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { renderRich, useFormat, useMessages, usePlural } from '../../../shared/i18n';
import { describeStepStatus, stepStatusTone } from '../lib/step-status';
import { runOutcomeTone } from '../lib/run-outcome';
import type { AutomationRunLog } from '../api/automation.types';

export interface AutomationRunLogPanelProps {
  log: AutomationRunLog | null;
  isLoading: boolean;
  error: unknown;
}

export function AutomationRunLogPanel({
  log,
  isLoading,
  error,
}: AutomationRunLogPanelProps): ReactElement {
  const messages = useMessages('automation');
  const copy = messages.runLog;
  const actionLabels: Record<string, string> = messages.actions;
  const outcomeLabels: Record<string, string> = messages.runOutcomes;
  const format = useFormat();
  const plural = usePlural();
  if (isLoading) {
    return <LoadingState title={copy.loading} message="" />;
  }
  if (error) {
    return <ErrorState title={copy.failed} message="" />;
  }
  // `null` means the envelope itself was unreadable — a different fact from
  // "recording is off", and not evidence for it.
  if (log === null) {
    return <ErrorState title={copy.failed} message="" />;
  }

  // Checked BEFORE the emptiness branch: while recording is off, an empty list
  // says nothing at all about whether the rule fired.
  if (!log.recordingAvailable) {
    return <Alert tone="info">{log.note ?? copy.empty}</Alert>;
  }

  if (log.runs.length === 0) {
    return <p className="muted-text">{copy.empty}</p>;
  }

  return (
    <ul className="automation-run-log">
      {log.runs.map((run) => (
        <li key={run.id} className="automation-run-log__run">
          <div className="automation-run-log__head">
            <StatusBadge tone={runOutcomeTone(run.outcome)} withDot compact>
              {outcomeLabels[run.outcome] ?? run.outcome}
            </StatusBadge>
            <span className="mono-text">{format.dateTime(run.firedAt)}</span>
            <span className="mono-text">{run.subjectId}</span>
          </div>

          {/* Names the OTHER rule — an operator cannot fix a collision they cannot name. */}
          {run.blockedByRuleIds !== null && run.blockedByRuleIds.length > 0 ? (
            <p className="muted-text">
              {renderRich(
                messages.runLogPanel.blockedBy,
                { ids: (chunk) => <span className="mono-text">{chunk}</span> },
                { ids: format.list(run.blockedByRuleIds.filter((id) => id !== run.ruleId)) },
              )}
            </p>
          ) : null}

          <ul className="automation-run-log__steps">
            {run.steps.map((step) => (
              <li key={step.stepIndex}>
                <span>{actionLabels[step.action] ?? step.action}</span>
                <StatusBadge tone={stepStatusTone(step.status)} compact>
                  {describeStepStatus(step.status)}
                </StatusBadge>
                {/* The backend's sentences, verbatim. */}
                {step.detail === null ? null : (
                  <span className="muted-text">{step.detail}</span>
                )}
                {step.unavailableReason === null ? null : (
                  <span className="muted-text">{step.unavailableReason}</span>
                )}
                {/*
                  `/jobs-logs/:id`, not `/jobs-logs?jobId=` — the list page reads
                  status/jobType/connectionId/outcome/offset and would silently
                  discard a `jobId`, landing the operator on an unfiltered list
                  from a control whose whole purpose is the failure detail.
                  A `Link`, not an `<a>`, so it does not reload out of the SPA.
                */}
                {step.syncJobId === null ? null : (
                  <Link className="mono-text" to={`/jobs-logs/${step.syncJobId}`}>
                    {copy.jobLink}
                  </Link>
                )}
              </li>
            ))}
          </ul>

          {run.unreadableStepCount > 0 ? (
            <p className="muted-text">
              {plural(run.unreadableStepCount, copy.unreadableSteps)}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
