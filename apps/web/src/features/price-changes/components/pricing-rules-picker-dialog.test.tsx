import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type * as ReactRouterDom from 'react-router-dom';
import { renderWithProviders, createMockApiClient, sampleConnection } from '../../../test/test-utils';
import { PricingRulesPickerDialog } from './pricing-rules-picker-dialog';
import type { Connection } from '../../connections';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (): Promise<typeof ReactRouterDom> => {
  const actual = await vi.importActual<typeof ReactRouterDom>('react-router-dom');
  return { ...actual, useNavigate: (): typeof navigateMock => navigateMock };
});

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

  it('navigates to the connection pricing-sync page on row click', async () => {
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

    await userEvent.click(await screen.findByRole('button', { name: 'Open' }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/connections/dest-1/pricing-sync');
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
