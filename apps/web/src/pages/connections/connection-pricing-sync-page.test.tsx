/**
 * ConnectionPricingSyncPage tests (#3149/#3166 review)
 *
 * @module apps/web/src/pages/connections
 */
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../test/test-utils';
import { ConnectionPricingSyncPage } from './connection-pricing-sync-page';
import type { ConnectionPricingSyncView } from '../../features/price-changes';

function buildView(): ConnectionPricingSyncView {
  return {
    default: { mode: 'manual', rule: { type: 'margin', percent: 22, rounding: 'endingIn99' } },
    sources: [],
  };
}

describe('ConnectionPricingSyncPage', () => {
  it('renders the section for a viable pricing destination', async () => {
    const apiClient = createMockApiClient({
      connections: {
        getById: vi.fn().mockResolvedValue({
          ...sampleConnection,
          id: 'dest-1',
          enabledCapabilities: ['OfferManager'],
        }),
      },
      pricingSync: { get: vi.fn().mockResolvedValue(buildView()) },
    });

    renderWithProviders(
      <Routes>
        <Route path="/connections/:connectionId/pricing-sync" element={<ConnectionPricingSyncPage />} />
      </Routes>,
      { apiClient, route: '/connections/dest-1/pricing-sync' },
    );

    expect(
      await screen.findByText(/keep a 22% margin/, { selector: '#conn-rule-note' }),
    ).toBeInTheDocument();
  });

  it('renders a neutral empty state for a connection that is not a pricing destination', async () => {
    const apiClient = createMockApiClient({
      connections: {
        getById: vi.fn().mockResolvedValue({
          ...sampleConnection,
          id: 'src-only-1',
          enabledCapabilities: ['OrderSource'],
        }),
      },
    });

    renderWithProviders(
      <Routes>
        <Route path="/connections/:connectionId/pricing-sync" element={<ConnectionPricingSyncPage />} />
      </Routes>,
      { apiClient, route: '/connections/src-only-1/pricing-sync' },
    );

    expect(await screen.findByText('Nothing to configure here')).toBeInTheDocument();
  });

  it('surfaces a connection load error', async () => {
    const apiClient = createMockApiClient({
      connections: { getById: vi.fn().mockRejectedValue(new Error('boom')) },
    });

    renderWithProviders(
      <Routes>
        <Route path="/connections/:connectionId/pricing-sync" element={<ConnectionPricingSyncPage />} />
      </Routes>,
      { apiClient, route: '/connections/dest-1/pricing-sync' },
    );

    await waitFor(() => {
      expect(screen.getByText('Unable to load connection')).toBeInTheDocument();
    });
  });
});
