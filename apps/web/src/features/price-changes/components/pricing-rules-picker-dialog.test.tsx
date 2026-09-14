import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient, sampleConnection } from '../../../test/test-utils';
import { PricingRulesPickerDialog } from './pricing-rules-picker-dialog';
import type { Connection } from '../../connections';

function conn(id: string, name: string): Connection {
  return { ...sampleConnection, id, name, enabledCapabilities: ['OfferManager'] };
}

describe('PricingRulesPickerDialog', () => {
  it('lists every destination connection with its default rule and override count', async () => {
    const get = vi.fn().mockImplementation((connectionId: string) =>
      Promise.resolve({
        default: { mode: 'manual', rule: { type: 'margin', percent: 22, rounding: 'endingIn99' } },
        sources:
          connectionId === 'dest-1'
            ? [
                {
                  sourceConnectionId: 'src-1',
                  sourceLabel: 'PrestaShop — Main Store',
                  isCustomOverride: true,
                  effective: { mode: 'manual', rule: { type: 'margin', percent: 30, rounding: 'endingIn99' } },
                  openEpisodeCount: 0,
                },
              ]
            : [],
      }),
    );
    const apiClient = createMockApiClient({ pricingSync: { get } });

    renderWithProviders(
      <PricingRulesPickerDialog
        open
        onOpenChange={vi.fn()}
        destinationConnections={[conn('dest-1', 'Allegro — PL')]}
      />,
      { apiClient },
    );

    expect(await screen.findByText(/Default: Manual review · 22% margin/)).toBeInTheDocument();
    expect(screen.getByText(/1 source with a different rule/)).toBeInTheDocument();
  });

  it('links to the connection pricing-sync page and closes the dialog on click (#3167 review, finding 4b)', async () => {
    const apiClient = createMockApiClient({
      pricingSync: {
        get: vi.fn().mockResolvedValue({
          default: { mode: 'manual', rule: { type: 'passthrough', percent: 0, rounding: 'none' } },
          sources: [],
        }),
      },
    });
    const onOpenChange = vi.fn();

    renderWithProviders(
      <PricingRulesPickerDialog
        open
        onOpenChange={onOpenChange}
        destinationConnections={[conn('dest-1', 'Allegro — PL')]}
      />,
      { apiClient },
    );

    const openLink = await screen.findByRole('link', { name: 'Open' });
    expect(openLink).toHaveAttribute('href', '/connections/dest-1/pricing-sync');

    // Not an ARIA nested-interactive violation: the row itself carries no
    // `role="button"`, only the real link is a focusable/actionable element.
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();

    await userEvent.click(openLink);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('reports a failed row as failed rather than loading forever (#3167 review, finding 4a)', async () => {
    const apiClient = createMockApiClient({
      pricingSync: { get: vi.fn().mockRejectedValue(new Error('boom')) },
    });

    renderWithProviders(
      <PricingRulesPickerDialog
        open
        onOpenChange={vi.fn()}
        destinationConnections={[conn('dest-1', 'Allegro — PL')]}
      />,
      { apiClient },
    );

    expect(await screen.findByText(/Couldn't load this connection's rule/)).toBeInTheDocument();
    // The row still links out — a failed read must not block navigation.
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/connections/dest-1/pricing-sync',
    );
  });

  it('shows an empty state with zero destination connections', () => {
    const apiClient = createMockApiClient({ pricingSync: { get: vi.fn() } });

    renderWithProviders(
      <PricingRulesPickerDialog open onOpenChange={vi.fn()} destinationConnections={[]} />,
      { apiClient },
    );

    expect(screen.getByText('No pricing destinations yet')).toBeInTheDocument();
  });
});
