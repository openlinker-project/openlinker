/**
 * Dry-run panel tests (#2366)
 *
 * The headline assertions exist because the earlier version rendered a green
 * "would have run" badge directly above a warning saying it would not have —
 * the affirmative half being the part an operator scans.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';
import { AutomationDryRunPanel } from './automation-dry-run-panel';
import type { AutomationDryRunResult } from '../api/automation.types';

const RESULT: AutomationDryRunResult = {
  trigger: 'order.packed',
  evaluatedAt: '2026-08-20T10:00:00.000Z',
  facts: {
    subjectKind: 'order',
    subjectId: 'ol_order_1',
    occurredAt: '2026-08-19T10:00:00.000Z',
    sourceConnectionId: 'conn-1',
    country: 'PL',
    totalGross: 100,
    currency: 'PLN',
  },
  verdicts: [
    {
      ruleId: 'draft',
      ruleName: 'Draft',
      isSubject: true,
      isActive: false,
      matches: true,
      wouldFire: true,
      nonFiringReason: null,
      conditionTraces: [
        { field: 'orderCountry', condition: { field: 'orderCountry', op: 'eq', value: 'PL' }, outcome: 'true' },
        { field: 'orderTotalGross', condition: { field: 'orderTotalGross', op: 'gte', amount: '500', currency: 'EUR' }, outcome: 'currency-mismatch' },
      ],
      retroactivityFloorWaived: false,
      blockedBy: null,
      stepAvailability: [],
    },
  ],
};

function render(overrides: Partial<Parameters<typeof AutomationDryRunPanel>[0]> = {}): void {
  const apiClient = createMockApiClient({
    connections: {
      list: vi.fn().mockResolvedValue([{ ...sampleConnection, id: 'conn-1', name: 'Allegro PL' }]),
    },
    orders: {
      list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
    },
  });
  renderWithProviders(
    <AutomationDryRunPanel
      onRun={vi.fn()}
      isRunning={false}
      result={RESULT}
      error={null}
      {...overrides}
    />,
    { apiClient },
  );
}

describe('AutomationDryRunPanel', () => {
  it('should affirm a rule that would genuinely have run', () => {
    render();
    expect(screen.getAllByText('This rule would have run').length).toBeGreaterThan(0);
  });

  it('should NOT affirm when the retroactivity floor was waived', () => {
    // The dry run waives the floor the real path enforces. An affirmative
    // headline with the waiver as fine print states the opposite of the truth.
    render({
      result: {
        ...RESULT,
        verdicts: [{ ...RESULT.verdicts[0], retroactivityFloorWaived: true }],
      },
    });

    expect(screen.getByText('This rule matches, but would not have run')).toBeInTheDocument();
    expect(screen.queryByText('This rule would have run')).toBeNull();
    expect(screen.getByText(/this order is older than the rule/)).toBeInTheDocument();
  });

  it('should render every condition trace with its outcome, labelled not paraphrased', () => {
    render();
    expect(screen.getByText('Matched')).toBeInTheDocument();
    // `currency-mismatch` is not `false` — it may be a rule the operator keeps.
    expect(screen.getByText('Different currency')).toBeInTheDocument();
  });

  it('should show the source connection, which a sourceConnection condition is about', async () => {
    // Omitting it would show a "Not matched" trace while withholding the fact
    // that explains it. Resolved to a name via the batched connections read.
    render();
    expect(await screen.findByText('Allegro PL')).toBeInTheDocument();
  });

  it('should name the other rule and the colliding actions on a collision', () => {
    render({
      result: {
        ...RESULT,
        verdicts: [
          {
            ...RESULT.verdicts[0],
            wouldFire: false,
            blockedBy: { collidingRuleIds: ['draft', 'rule-2'], actions: ['dispatch-shipment'] },
          },
        ],
      },
    });

    expect(screen.getByText('rule-2')).toBeInTheDocument();
    expect(screen.getByText('dispatch-shipment')).toBeInTheDocument();
  });

  it('should say a result is stale rather than leave it standing as current', () => {
    render({ isStale: true });
    expect(
      screen.getByText(/the result below describes the previous version/),
    ).toBeInTheDocument();
  });

  it('should render a refusal instead of an empty verdict list', () => {
    // "This rule matches nothing" and "we never evaluated it" are different
    // claims, and only one of them is true.
    render({ result: null, error: new Error('Step 1 is malformed.') });

    expect(screen.getByText('The test did not run')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Nothing was evaluated, so this says nothing about whether the rule would match.',
      ),
    ).toBeInTheDocument();
  });

  it('should say there are no orders to test against rather than look broken', async () => {
    render({ result: null });
    expect(
      await screen.findByText(
        'No orders in the last 30 days, so there is nothing to test against yet.',
      ),
    ).toBeInTheDocument();
  });
});
