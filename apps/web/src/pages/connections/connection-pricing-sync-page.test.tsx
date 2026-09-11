/**
 * ConnectionPricingSyncPage tests (#3149/#3166 review, #3150/#3167 review)
 *
 * @module apps/web/src/pages/connections
 */
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../test/test-utils';
import { ConnectionPricingSyncPage } from './connection-pricing-sync-page';
import type { ConnectionPricingSyncView, ConnectionAsSourceEntry } from '../../features/price-changes';

function buildView(): ConnectionPricingSyncView {
  return {
    default: { mode: 'manual', rule: { type: 'margin', percent: 22, rounding: 'endingIn99' } },
    sources: [],
  };
}

function buildAsSourceEntries(): ConnectionAsSourceEntry[] {
  return [
    {
      destinationConnectionId: 'dest-2',
      destinationLabel: 'Erli — PL',
      effectiveMode: 'automatic',
      effectiveRuleSummary: { type: 'markup', percent: 15, rounding: 'none' },
      isCustomOverride: false,
    },
  ];
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

  it('renders the read-only rollup for a source-only connection (#3150)', async () => {
    const apiClient = createMockApiClient({
      connections: {
        getById: vi.fn().mockResolvedValue({
          ...sampleConnection,
          id: 'src-1',
          enabledCapabilities: ['ProductMaster'],
        }),
      },
      pricingSync: { asSource: vi.fn().mockResolvedValue(buildAsSourceEntries()) },
    });

    renderWithProviders(
      <Routes>
        <Route path="/connections/:connectionId/pricing-sync" element={<ConnectionPricingSyncPage />} />
      </Routes>,
      { apiClient, route: '/connections/src-1/pricing-sync' },
    );

    expect(await screen.findByText('Erli — PL')).toBeInTheDocument();
    // Read-only: the editable settings section never renders for a
    // connection with nothing to publish or list.
    expect(screen.queryByText('Default pricing rule')).not.toBeInTheDocument();
  });

  it('renders BOTH the editable settings and the read-only rollup for a connection that is both a destination and a source (#3167 review, finding 2)', async () => {
    const apiClient = createMockApiClient({
      connections: {
        getById: vi.fn().mockResolvedValue({
          ...sampleConnection,
          id: 'both-1',
          enabledCapabilities: ['ProductPublisher', 'ProductMaster'],
        }),
      },
      pricingSync: {
        get: vi.fn().mockResolvedValue(buildView()),
        asSource: vi.fn().mockResolvedValue(buildAsSourceEntries()),
      },
    });

    renderWithProviders(
      <Routes>
        <Route path="/connections/:connectionId/pricing-sync" element={<ConnectionPricingSyncPage />} />
      </Routes>,
      { apiClient, route: '/connections/both-1/pricing-sync' },
    );

    expect(await screen.findByText('Default pricing rule')).toBeInTheDocument();
    expect(await screen.findByText('Erli — PL')).toBeInTheDocument();
  });

  it('threads `?source=` into the editable section to pre-expand that source (#3148 permalink / #3150 rollup "Manage" link)', async () => {
    const view: ConnectionPricingSyncView = {
      default: { mode: 'manual', rule: { type: 'margin', percent: 22, rounding: 'endingIn99' } },
      sources: [
        {
          sourceConnectionId: 'src-1',
          sourceLabel: 'PrestaShop — Main Store',
          isCustomOverride: false,
          effective: { mode: 'manual', rule: { type: 'margin', percent: 22, rounding: 'endingIn99' } },
          openEpisodeCount: 0,
        },
      ],
    };
    const apiClient = createMockApiClient({
      connections: {
        getById: vi.fn().mockResolvedValue({
          ...sampleConnection,
          id: 'dest-1',
          enabledCapabilities: ['OfferManager'],
        }),
      },
      pricingSync: { get: vi.fn().mockResolvedValue(view) },
    });

    renderWithProviders(
      <Routes>
        <Route path="/connections/:connectionId/pricing-sync" element={<ConnectionPricingSyncPage />} />
      </Routes>,
      { apiClient, route: '/connections/dest-1/pricing-sync?source=src-1' },
    );

    const checkbox = await screen.findByTestId('source-custom-toggle');
    expect(checkbox).toBeChecked();
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
