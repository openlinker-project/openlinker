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
        isCustomOverride: false,
      },
      {
        destinationConnectionId: 'dest-2',
        destinationLabel: 'Erli — PL',
        effectiveMode: 'automatic',
        effectiveRuleSummary: { type: 'markup', percent: 15, rounding: 'none' },
        isCustomOverride: true,
      },
    ]);
    const apiClient = createMockApiClient({ pricingSync: { asSource } });

    renderWithProviders(<SourceConnectionPricingRollup connectionId="src-1" />, { apiClient });

    expect(await screen.findByText('Allegro — PL')).toBeInTheDocument();
    expect(screen.getByText(/using Allegro — PL's default rule/)).toBeInTheDocument();
    expect(screen.getByText(/a rule just for this source/)).toBeInTheDocument();

    // Read-only per ADR decision 2: the only interactive elements are the
    // "Manage" navigation links, never a form control that could mutate.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    const manageLinks = screen.getAllByRole('link', { name: 'Manage' });
    expect(manageLinks[0]).toHaveAttribute('href', '/connections/dest-1/pricing-sync?source=src-1');
    expect(manageLinks[1]).toHaveAttribute('href', '/connections/dest-2/pricing-sync?source=src-1');
  });

  it('shows an empty state with no destinations yet', async () => {
    const apiClient = createMockApiClient({
      pricingSync: { asSource: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SourceConnectionPricingRollup connectionId="src-1" />, { apiClient });

    expect(await screen.findByText('No destinations yet')).toBeInTheDocument();
  });
});
