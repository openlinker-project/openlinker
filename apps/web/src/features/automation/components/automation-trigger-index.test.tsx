/**
 * Trigger index tests (#2364)
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { AutomationTriggerIndex, buildTriggerRows } from './automation-trigger-index';
import { AUTOMATION_TRIGGER_VALUES, type AutomationVocabulary } from '../api/automation.types';

const vocabulary: AutomationVocabulary = {
  triggers: AUTOMATION_TRIGGER_VALUES.map((value) => ({
    value,
    firingMode: 'edge' as const,
    configKey: null,
    legalActions: ['relay-status-to-source', 'dispatch-shipment'],
    legalConditionFields: [],
  })),
  actions: [
    { action: 'relay-status-to-source', availability: 'available', reason: null, irreversible: false },
    {
      action: 'dispatch-shipment',
      availability: 'unavailable',
      reason: 'Buying a shipping label from an automation is not built yet.',
      irreversible: true,
    },
  ],
  conditionFields: [],
  amountOps: [],
  holdReasons: [],
  stepBounds: { min: 1, max: 3 },
  runOutcomes: [],
  stepStatuses: [],
  nonFiringReasons: [],
  conditionOutcomes: [],
};

const summary = AUTOMATION_TRIGGER_VALUES.map((trigger) => ({ trigger, ruleCount: 0 }));

describe('buildTriggerRows', () => {
  it('should keep every trigger the summary reported, zeros included', () => {
    // A trigger absent from the index reads as "not supported" rather than
    // "nothing configured", and only the second is actionable.
    const rows = buildTriggerRows(summary, vocabulary);
    expect(rows).toHaveLength(8);
  });

  it('should count only the legal actions that can actually run', () => {
    const rows = buildTriggerRows(summary, vocabulary);
    expect(rows[0].legalActionCount).toBe(2);
    expect(rows[0].runnableActionCount).toBe(1);
  });

  it('should report no runnable actions rather than guessing when the vocabulary is absent', () => {
    const rows = buildTriggerRows(summary, undefined);
    expect(rows[0].legalActionCount).toBe(0);
    expect(rows[0].runnableActionCount).toBe(0);
  });
});

describe('AutomationTriggerIndex', () => {
  it('should render all eight triggers in operator words', () => {
    renderWithProviders(<AutomationTriggerIndex rows={buildTriggerRows(summary, vocabulary)} />);

    expect(screen.getByText('An order is marked packed')).toBeInTheDocument();
    expect(screen.getByText('A return arrives')).toBeInTheDocument();
    expect(screen.getByText('You have sold more than you have')).toBeInTheDocument();
  });

  it('should report the rule count per trigger', () => {
    const rows = buildTriggerRows(
      summary.map((row) => (row.trigger === 'order.packed' ? { ...row, ruleCount: 2 } : row)),
      vocabulary,
    );
    renderWithProviders(<AutomationTriggerIndex rows={rows} />);

    expect(screen.getByText('2 rules')).toBeInTheDocument();
    expect(screen.getAllByText('No rules').length).toBeGreaterThan(0);
  });

  it('should say last-acted is not recorded rather than showing a bare dash', () => {
    // A dash reads as "never", which is a claim about the operator's history
    // that no shipped response supports.
    renderWithProviders(<AutomationTriggerIndex rows={buildTriggerRows(summary, vocabulary)} />);
    expect(screen.getAllByLabelText('Not recorded yet').length).toBeGreaterThan(0);
  });
});
