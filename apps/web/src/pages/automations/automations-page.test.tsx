/**
 * Automations index tests (#2629 review, I8)
 *
 * An unreadable list envelope yields zero items AND zero drops, which is
 * indistinguishable from "the server said there are none" unless the parse
 * layer reports it. The card that must never appear there is the first-run
 * suggestion: it tells an operator with ten rules that they have none.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../test/test-utils';
import { AutomationsPage } from './automations-page';

const VOCABULARY = {
  triggers: [
    {
      value: 'order.packed',
      label: 'Order packed',
      description: null,
      firingMode: 'once',
      legalActions: ['dispatch-shipment'],
      configKey: null,
    },
  ],
  actions: [
    { action: 'dispatch-shipment', label: 'Buy a label', availability: 'available', reason: null },
  ],
  conditionFields: [],
  amountOps: [],
  holdReasons: [],
  stepBounds: { min: 1, max: 5 },
  runOutcomes: [],
  stepStatuses: [],
  nonFiringReasons: [],
  conditionOutcomes: [],
};

function render(summary: unknown): void {
  const apiClient = createMockApiClient({
    automations: {
      getVocabulary: vi.fn().mockResolvedValue(VOCABULARY),
      getSummary: vi.fn().mockResolvedValue(summary),
    },
  });
  renderWithProviders(<AutomationsPage />, { apiClient, route: '/automations' });
}

describe('AutomationsPage', () => {
  it('should say it could not read the list rather than offering the first-run card', async () => {
    render({ items: [], droppedCount: 0, envelopeUnreadable: true });

    expect(await screen.findByText('Unable to read the automations list')).toBeInTheDocument();
    expect(screen.queryByText('You have no automations yet.')).toBeNull();
  });

  it('should still offer the first-run card when the server really reports no rules', async () => {
    render({
      items: [{ trigger: 'order.packed', ruleCount: 0 }],
      droppedCount: 0,
      envelopeUnreadable: false,
    });

    expect(await screen.findByText('You have no automations yet.')).toBeInTheDocument();
    expect(screen.queryByText('Unable to read the automations list')).toBeNull();
  });
});
