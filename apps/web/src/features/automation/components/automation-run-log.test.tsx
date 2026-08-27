/**
 * Fired-log tests (#2366)
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { AutomationRunLogPanel } from './automation-run-log';
import type { AutomationRunLog as RunLog } from '../api/automation.types';

const FAILED_DETAIL = 'The carrier refused the parcel: weight missing.';

const LOG: RunLog = {
  recordingAvailable: true,
  note: null,
  limit: 50,
  hasMore: false,
  runs: [
    {
      id: 'run-1',
      ruleId: 'rule-1',
      ruleName: 'Buy a label',
      trigger: 'order.packed',
      subjectKind: 'order',
      subjectId: 'ol_order_1',
      outcome: 'failed',
      steps: [
        {
          stepIndex: 0,
          action: 'dispatch-shipment',
          status: 'failed',
          detail: FAILED_DETAIL,
          syncJobId: 'job-9',
          unavailableReason: null,
          report: null,
        },
        {
          stepIndex: 1,
          action: 'relay-status-to-source',
          status: 'skipped',
          detail: null,
          syncJobId: null,
          unavailableReason: null,
          report: null,
        },
      ],
      unreadableStepCount: 0,
      blockedByRuleIds: null,
      firedAt: '2026-08-20T10:00:00.000Z',
      needsAttention: false,
      retryable: false,
      retryRefusalReason: null,
      dismissedAt: null,
      dismissedByUserId: null,
      retryOfRunId: null,
    },
  ],
};

describe('AutomationRunLog', () => {
  it('should show a failure with its reason, not just that it failed', () => {
    renderWithProviders(<AutomationRunLogPanel log={LOG} isLoading={false} error={null} />);

    // Twice, and both are right: the run's outcome and the step's own status.
    expect(screen.getAllByText('Failed')).toHaveLength(2);
    // The backend's own sentence, verbatim — the REASON, not just the fact.
    expect(screen.getByText(FAILED_DETAIL)).toBeInTheDocument();
  });

  it('should render a skipped step explicitly', () => {
    // A silently missing step is indistinguishable from one that was never
    // configured — which is exactly why the backend records `skipped`.
    renderWithProviders(<AutomationRunLogPanel log={LOG} isLoading={false} error={null} />);
    expect(screen.getByText('Skipped')).toBeInTheDocument();
  });

  it('should link a step to the job DETAIL route, not a query the list ignores', () => {
    // `/jobs-logs` reads status/jobType/connectionId/outcome/offset and nothing
    // else, so `?jobId=` would be silently discarded and land the operator on an
    // unfiltered list — from the one control that exists to reach the failure.
    renderWithProviders(<AutomationRunLogPanel log={LOG} isLoading={false} error={null} />);
    expect(screen.getByRole('link', { name: 'Job' })).toHaveAttribute(
      'href',
      '/jobs-logs/job-9',
    );
  });

  it('should lead with the note and show no empty state while recording is off', () => {
    const note = 'Automation runs are not recorded in this build yet.';
    renderWithProviders(
      <AutomationRunLogPanel
        log={{ ...LOG, runs: [], recordingAvailable: false, note }}
        isLoading={false}
        error={null}
      />,
    );

    expect(screen.getByText(note)).toBeInTheDocument();
    // An empty list here says NOTHING about whether the rule fired.
    expect(screen.queryByText('This rule has not run yet.')).toBeNull();
  });

  it('should show the empty state only when recording is genuinely on', () => {
    renderWithProviders(
      <AutomationRunLogPanel log={{ ...LOG, runs: [] }} isLoading={false} error={null} />,
    );
    expect(screen.getByText('This rule has not run yet.')).toBeInTheDocument();
  });

  it('should treat an unreadable envelope as an error, never as "recording is off"', () => {
    renderWithProviders(<AutomationRunLogPanel log={null} isLoading={false} error={null} />);
    expect(screen.getByText('Unable to load this rule’s history.')).toBeInTheDocument();
  });

  it('should name the other rule on a blocked run', () => {
    renderWithProviders(
      <AutomationRunLogPanel
        log={{
          ...LOG,
          runs: [
            {
              ...LOG.runs[0],
              outcome: 'blocked',
              blockedByRuleIds: ['rule-1', 'rule-2'],
            },
          ],
        }}
        isLoading={false}
        error={null}
      />,
    );

    expect(screen.getByText('Held back')).toBeInTheDocument();
    // The OTHER rule, not this one — a collision an operator cannot name is a
    // collision they cannot fix.
    expect(screen.getByText('rule-2')).toBeInTheDocument();
  });

  it('should report steps it could not read rather than hiding them', () => {
    renderWithProviders(
      <AutomationRunLogPanel
        log={{ ...LOG, runs: [{ ...LOG.runs[0], unreadableStepCount: 2 }] }}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText('2 steps could not be read and are not shown.')).toBeInTheDocument();
  });
});
