/**
 * Activity-table tests (#2386)
 *
 * The two properties an operator is harmed by if they regress: an outcome that
 * is not a failure must not render as one, and the job link must exist exactly
 * when a step dispatched a job — pointing at a route that honours the id.
 */
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { AutomationActivityTable } from './automation-activity-table';
import type { AutomationRun } from '../api/automation.types';

const FAILURE = 'The carrier refused the parcel: weight missing.';

function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: 'run-1',
    ruleId: 'rule-1',
    ruleName: 'Buy a label when packed',
    trigger: 'order.packed',
    subjectKind: 'order',
    subjectId: 'ol_order_1',
    outcome: 'done',
    steps: [
      { stepIndex: 0, action: 'relay-status-to-source', status: 'done', detail: null, syncJobId: null, unavailableReason: null, report: null },
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
    ...overrides,
  };
}

function render(runs: AutomationRun[]): void {
  renderWithProviders(
    <AutomationActivityTable
      runs={runs}
      emptyState={<p>Empty</p>}
      canWrite
      readOnlyLocked={false}
      readOnlyMessage="Read only"
    />,
  );
}

describe('AutomationActivityTable', () => {
  it('should render all six columns', () => {
    render([run()]);
    for (const header of ['When', 'Automation', 'Trigger', 'Order or return', 'What it did', 'Result']) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
  });

  it('should link the rule, the subject, and nothing else when no job was dispatched', () => {
    render([run()]);

    expect(screen.getByRole('link', { name: 'Buy a label when packed' })).toHaveAttribute(
      'href',
      '/automations/order.packed',
    );
    expect(screen.getByRole('link', { name: 'ol_order_1' })).toHaveAttribute(
      'href',
      '/orders/ol_order_1',
    );
    // No job link — the step dispatched none, and a dead link is worse than none.
    expect(screen.queryByRole('link', { name: 'Job' })).toBeNull();
  });

  it('should link a dispatched step to the job DETAIL route', () => {
    // `/jobs-logs?jobId=` is silently ignored by that page — the #2366 defect.
    render([
      run({
        steps: [
          { stepIndex: 0, action: 'dispatch-shipment', status: 'done', detail: null, syncJobId: 'job-9', unavailableReason: null, report: null },
        ],
      }),
    ]);
    expect(screen.getByRole('link', { name: 'Job' })).toHaveAttribute('href', '/jobs-logs/job-9');
  });

  it('should show a failure reason inline, not behind a click', () => {
    render([
      run({
        outcome: 'failed',
        steps: [
          { stepIndex: 0, action: 'dispatch-shipment', status: 'failed', detail: FAILURE, syncJobId: null, unavailableReason: null, report: null },
          { stepIndex: 1, action: 'relay-status-to-source', status: 'skipped', detail: null, syncJobId: null, unavailableReason: null, report: null },
        ],
      }),
    ]);

    expect(screen.getByText(FAILURE)).toBeInTheDocument();
    // And states which later step did not run.
    expect(screen.getByText('Skipped')).toBeInTheDocument();
  });

  it('should NOT render "Nothing to do" as a failure', () => {
    // A rule that fired and found the work already done is not an error, and
    // must not feed any attention count.
    render([run({ outcome: 'nothing-to-do' })]);
    const badge = screen.getByText('Nothing to do');
    expect(badge.className).not.toContain('error');
  });

  it('should NOT render "Blocked" as a failure', () => {
    // Nothing ran because a sibling rule won — that is not a failure either.
    render([run({ outcome: 'blocked' })]);
    const badge = screen.getByText('Held back');
    expect(badge.className).not.toContain('error');
  });

  it('should render the rule name as it fired, not a current one', () => {
    render([run({ ruleName: 'Old name' })]);
    expect(screen.getByRole('link', { name: 'Old name' })).toBeInTheDocument();
  });

  it('should route a return subject to the returns detail', () => {
    render([run({ subjectKind: 'return', subjectId: 'ol_return_1' })]);
    expect(screen.getByRole('link', { name: 'ol_return_1' })).toHaveAttribute(
      'href',
      '/returns/ol_return_1',
    );
  });

  it('should keep the failure reason visible at tablet width', () => {
    // Card view starts at MOBILE width, but the style guide puts tablet on
    // "full table, scrolled horizontally" — so a `hideBelow` on the steps
    // column leaves the whole 768–1023 band with a Failed badge and no reason.
    render([
      run({
        outcome: 'failed',
        steps: [
          { stepIndex: 0, action: 'dispatch-shipment', status: 'failed', detail: FAILURE, syncJobId: null, unavailableReason: null, report: null },
        ],
      }),
    ]);

    const reason = screen.getByText(FAILURE);
    expect(reason.closest('.data-table__cell--hide-below-1024')).toBeNull();
  });

  it('should name what a skipped step did not do', () => {
    render([
      run({
        outcome: 'failed',
        steps: [
          { stepIndex: 0, action: 'dispatch-shipment', status: 'failed', detail: FAILURE, syncJobId: null, unavailableReason: null, report: null },
          { stepIndex: 1, action: 'relay-status-to-source', status: 'skipped', detail: null, syncJobId: null, unavailableReason: null, report: null },
        ],
      }),
    ]);
    expect(screen.getByText(/Tell the marketplace — did not run/)).toBeInTheDocument();
  });

  it('should render the supplied empty state when there are no runs', () => {
    render([]);
    expect(screen.getByText('Empty')).toBeInTheDocument();
  });

  it('should render every step of a multi-step run, in order', () => {
    render([
      run({
        steps: [
          { stepIndex: 0, action: 'dispatch-shipment', status: 'done', detail: null, syncJobId: null, unavailableReason: null, report: null },
          { stepIndex: 1, action: 'relay-status-to-source', status: 'done', detail: null, syncJobId: null, unavailableReason: null, report: null },
        ],
      }),
    ]);
    const list = screen.getAllByRole('list')[0];
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });
});
