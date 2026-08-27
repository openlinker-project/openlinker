/**
 * The cross-rule run log (#2386, spec §5.6 c)
 *
 * The counterpart to `/sync/jobs` for automations — what has been happening,
 * when the operator has no specific order in hand.
 *
 * ## Three link targets per row
 *
 * The subject (order/return), the rule, and — **exactly when the step dispatched
 * a job** — the `sync_jobs` row, so technical failure detail stays in the
 * existing job detail rather than being re-rendered here. `step.syncJobId` is
 * the discriminator; absent means no link, never a dead one. The target is
 * `/jobs-logs/:id`, the DETAIL route: `/jobs-logs?jobId=` is silently ignored by
 * that page, which is the defect #2366 fixed and must not be re-made here.
 *
 * ## Two of the four outcomes are not failures
 *
 * `Nothing to do` is a rule that fired and found the work already done;
 * `Blocked` is the two-money-rules case where NOTHING ran. Neither is toned as
 * an error and neither feeds any attention count.
 *
 * @module apps/web/src/features/automation/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import {
  AUTOMATION_ACTION_LABELS,
  AUTOMATION_ACTIVITY_COPY,
  AUTOMATION_RUN_OUTCOME_COPY,
} from '../lib/automation.copy';
import { describeStepStatus, stepStatusTone } from '../lib/step-status';
import { runOutcomeTone } from '../lib/run-outcome';
import { describeTrigger } from '../lib/automation-trigger-labels';
import type { AutomationRun, AutomationStepResult } from '../api/automation.types';

function StepLine({ step }: { step: AutomationStepResult }): ReactElement {
  const label = AUTOMATION_ACTION_LABELS[step.action] ?? step.action;
  return (
    <li className="automation-activity__step">
      <StatusBadge tone={stepStatusTone(step.status)} compact>
        {describeStepStatus(step.status)}
      </StatusBadge>
      <span>
        {label}
        {step.status === 'skipped' ? ` — ${AUTOMATION_ACTIVITY_COPY.skippedSuffix}` : ''}
      </span>
      {/* The backend's own sentences, verbatim — the reason is inline, not behind a click. */}
      {step.detail === null ? null : <span className="muted-text">{step.detail}</span>}
      {step.unavailableReason === null ? null : (
        <span className="muted-text">{step.unavailableReason}</span>
      )}
      {step.syncJobId === null ? null : (
        <Link className="mono-text" to={`/jobs-logs/${step.syncJobId}`}>
          {AUTOMATION_ACTIVITY_COPY.viewJob}
        </Link>
      )}
    </li>
  );
}

interface AutomationActivityTableProps {
  runs: AutomationRun[];
  emptyState: ReactElement;
}

export function AutomationActivityTable({
  runs,
  emptyState,
}: AutomationActivityTableProps): ReactElement {
  const columns: DataTableColumn<AutomationRun>[] = [
    {
      id: 'when',
      header: AUTOMATION_ACTIVITY_COPY.whenHeader,
      // Newest first is the server's order (`firedAt DESC`) and the default here.
      cell: (run) => <TimeDisplay iso={run.firedAt} format="relative" title={run.firedAt} />,
    },
    {
      id: 'rule',
      header: AUTOMATION_ACTIVITY_COPY.ruleHeader,
      cell: (run) => (
        // The rule NAME as it fired — frozen at write time, so a rename or a
        // deletion never makes history unreadable.
        <Link to={`/automations/${encodeURIComponent(run.trigger)}`}>{run.ruleName}</Link>
      ),
    },
    {
      id: 'trigger',
      // The one column that MAY hide: an operator can recover the event from
      // the rule name. A failure reason is recoverable from nothing, which is
      // why the steps column below carries no `hideBelow`.
      hideBelow: 1024,
      header: AUTOMATION_ACTIVITY_COPY.triggerHeader,
      cell: (run) => <span>{describeTrigger(run.trigger).label}</span>,
    },
    {
      id: 'subject',
      header: AUTOMATION_ACTIVITY_COPY.subjectHeader,
      cell: (run) =>
        run.subjectKind === 'order' ? (
          <Link className="mono-text" to={`/orders/${encodeURIComponent(run.subjectId)}`}>
            {run.subjectId}
          </Link>
        ) : (
          <Link className="mono-text" to={`/returns/${encodeURIComponent(run.subjectId)}`}>
            {run.subjectId}
          </Link>
        ),
    },
    {
      id: 'steps',
      header: AUTOMATION_ACTIVITY_COPY.stepsHeader,
      // NO `hideBelow`, deliberately. Card view starts at mobile width, but the
      // style guide puts TABLET on "full table, scrolled horizontally" — so a
      // hidden column here leaves the whole 768–1023 band with a `Failed` badge
      // and no reason at all, which is the AC this column exists to satisfy.
      // The container scrolls; that is the documented tablet behaviour.
      cell: (run) => (
        <ul className="automation-activity__steps">
          {run.steps.map((step) => (
            <StepLine key={step.stepIndex} step={step} />
          ))}
        </ul>
      ),
    },
    {
      id: 'outcome',
      header: AUTOMATION_ACTIVITY_COPY.outcomeHeader,
      cell: (run) => (
        <StatusBadge tone={runOutcomeTone(run.outcome)} withDot compact>
          {(AUTOMATION_RUN_OUTCOME_COPY as Record<string, string>)[run.outcome] ?? run.outcome}
        </StatusBadge>
      ),
    },
  ];

  return (
    <DataTable
      caption={AUTOMATION_ACTIVITY_COPY.title}
      columns={columns}
      rows={runs}
      rowKey={(run) => run.id}
      emptyState={emptyState}
      cardView={{
        title: (run) => run.ruleName,
        subtitle: (run) => describeTrigger(run.trigger).label,
        meta: (run) => <TimeDisplay iso={run.firedAt} format="relative" />,
        detail: (run) => (
          <ul className="automation-activity__steps">
            {run.steps.map((step) => (
              <StepLine key={step.stepIndex} step={step} />
            ))}
          </ul>
        ),
      }}
    />
  );
}
