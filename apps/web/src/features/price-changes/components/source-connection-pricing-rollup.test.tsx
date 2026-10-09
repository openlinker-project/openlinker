import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { SourceConnectionPricingRollup } from './source-connection-pricing-rollup';

describe('SourceConnectionPricingRollup', () => {
  it('renders one row per destination with the effective rule sentence and no write affordance', async () => {
    const asSource = vi.fn().mockResolvedValue([
      {
        destinationConnectionId: 'dest-1',
        destinationLabel: 'Allegro — PL',
        effectiveMode: 'manual',
        effectiveRuleSummary: { type: 'margin', percent: 22, rounding: 'endingIn99' },
        modeOverridden: false,
        ruleOverridden: false,
      },
      {
        destinationConnectionId: 'dest-2',
        destinationLabel: 'Erli — PL',
        effectiveMode: 'automatic',
        effectiveRuleSummary: { type: 'markup', percent: 15, rounding: 'none' },
        modeOverridden: false,
        ruleOverridden: true,
      },
      {
        destinationConnectionId: 'dest-3',
        destinationLabel: 'Kaufland — DE',
        effectiveMode: 'automatic',
        effectiveRuleSummary: { type: 'margin', percent: 22, rounding: 'endingIn99' },
        modeOverridden: true,
        ruleOverridden: false,
      },
      {
        destinationConnectionId: 'dest-4',
        destinationLabel: 'Amazon — DE',
        effectiveMode: 'automatic',
        effectiveRuleSummary: { type: 'markup', percent: 5, rounding: 'none' },
        modeOverridden: true,
        ruleOverridden: true,
      },
    ]);
    const apiClient = createMockApiClient({ pricingSync: { asSource } });

    renderWithProviders(<SourceConnectionPricingRollup connectionId="src-1" />, { apiClient });

    expect(await screen.findByText('Allegro — PL')).toBeInTheDocument();
    expect(screen.getByText(/using Allegro — PL's default rule/)).toBeInTheDocument();
    expect(screen.getByText(/— own rule just for this source/)).toBeInTheDocument();
    expect(screen.getByText(/— own mode just for this source/)).toBeInTheDocument();
    expect(screen.getByText(/— own mode and rule just for this source/)).toBeInTheDocument();

    // Read-only per ADR decision 2: the only interactive elements are the
    // "Manage" navigation links, never a form control that could mutate.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    const manageLinks = screen.getAllByRole('link', { name: 'Manage' });
    expect(manageLinks[0]).toHaveAttribute('href', '/connections/dest-1/pricing-sync?source=src-1');
    expect(manageLinks[1]).toHaveAttribute('href', '/connections/dest-2/pricing-sync?source=src-1');
  });

  it('shows an empty state that does not claim nothing consumes this source', async () => {
    const apiClient = createMockApiClient({
      pricingSync: { asSource: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SourceConnectionPricingRollup connectionId="src-1" />, { apiClient });

    expect(await screen.findByText('Nothing to show yet')).toBeInTheDocument();
    expect(
      screen.getByText(/No destinations are adjusting your prices right now/),
    ).toBeInTheDocument();
    // The section heading/explanatory copy survives the empty case (#3167
    // review, suggestion) — the empty state replaces only the row list, not
    // the whole section.
    expect(screen.getByText('How your prices get adjusted')).toBeInTheDocument();
  });

  it('renders a destination with no pricing rule as "no adjustment" instead of crashing', async () => {
    const asSource = vi.fn().mockResolvedValue([
      {
        destinationConnectionId: 'dest-1',
        destinationLabel: 'Allegro — PL',
        effectiveMode: 'manual',
        effectiveRuleSummary: null,
        modeOverridden: false,
        ruleOverridden: false,
      },
    ]);
    const apiClient = createMockApiClient({ pricingSync: { asSource } });

    renderWithProviders(<SourceConnectionPricingRollup connectionId="src-1" />, { apiClient });

    expect(await screen.findByText('Allegro — PL')).toBeInTheDocument();
    expect(screen.getByText(/no adjustment/i)).toBeInTheDocument();
  });
});
