/**
 * Sourcing rules page (#3060)
 *
 * The page owns two gates and nothing else, so this file asserts exactly those
 * two — and that neither of them is reported while the reads are still in
 * flight or after one failed, which would state something about the operator's
 * configuration from a network problem.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, renderWithProviders } from '../../test/test-utils';
import { ApiError } from '../../shared/api/api-error';
import { SourcingRulesPage } from './sourcing-rules-page';

interface ConnectionLike {
  id: string;
  platformType: string;
}

function omsConnection(id = 'conn_oms'): ConnectionLike {
  return { id, platformType: 'openlinker' };
}

function renderPage(options: {
  connections?: unknown;
  connectionsError?: unknown;
  locations?: unknown;
  search?: string;
}): void {
  const apiClient = createMockApiClient({
    connections: {
      list:
        options.connectionsError === undefined
          ? vi.fn().mockResolvedValue(options.connections ?? [])
          : vi.fn().mockRejectedValue(options.connectionsError),
    } as never,
    inventory: {
      listLocations: vi
        .fn()
        .mockResolvedValue({ items: options.locations ?? [], total: 0, page: 1, limit: 200 }),
    } as never,
    sourcingRules: { list: vi.fn().mockResolvedValue([]) } as never,
  });

  renderWithProviders(<SourcingRulesPage />, {
    apiClient,
    route: `/settings/sourcing-rules${options.search ?? ''}`,
  });
}

describe('SourcingRulesPage (#3060)', () => {
  it('reports neither gate while the reads are in flight', () => {
    renderPage({});

    expect(screen.getByText('Opening sourcing rules')).toBeInTheDocument();
    expect(screen.queryByText(/not your OpenLinker OMS connection/)).toBeNull();
    expect(screen.queryByText(/No locations to route to yet/)).toBeNull();
  });

  it('reports neither gate when a read FAILED', async () => {
    renderPage({ connectionsError: new ApiError('boom', 503, {}) });

    expect(await screen.findByText('Could not open sourcing rules')).toBeInTheDocument();
    // A failed read is not a statement about the operator's configuration.
    expect(screen.getByText(/Nothing has changed/)).toBeInTheDocument();
    expect(screen.queryByText(/is not enabled/)).toBeNull();
  });

  it('gates on there being an OMS connection at all', async () => {
    renderPage({ connections: [{ id: 'conn_shop', platformType: 'prestashop' }] });

    // "The OMS is not enabled" and "you are looking at the wrong connection"
    // have different remedies, so they are distinct copy.
    expect(await screen.findByText('The OpenLinker OMS is not enabled')).toBeInTheDocument();
  });

  it('refuses a NAMED connection that is not the OMS one', async () => {
    renderPage({
      connections: [omsConnection(), { id: 'conn_shop', platformType: 'prestashop' }],
      search: '?connectionId=conn_shop',
      locations: [{ id: 'loc_a', code: 'MAIN', name: 'Main', status: 'active' }],
    });

    // A ruleset authored here would never be read: the backend refuses
    // authoring on anything but the OMS connection.
    expect(
      await screen.findByText('This is not your OpenLinker OMS connection')
    ).toBeInTheDocument();
  });

  it('gates on there being an ACTIVE location', async () => {
    renderPage({
      connections: [omsConnection()],
      locations: [{ id: 'loc_a', code: 'OLD', name: 'Retired depot', status: 'inactive' }],
    });

    // Rules choose BETWEEN locations; a ruleset that can only rank retired
    // warehouses decides nothing.
    expect(await screen.findByText('No locations to route to yet')).toBeInTheDocument();
  });

  it('renders the section once both gates pass', async () => {
    renderPage({
      connections: [omsConnection()],
      locations: [{ id: 'loc_a', code: 'MAIN', name: 'Main warehouse', status: 'active' }],
    });

    expect(
      await screen.findByText('Nothing decides where an order ships from yet')
    ).toBeInTheDocument();
  });

  it('links back to settings, because the tile is the only way in', async () => {
    renderPage({ connections: [omsConnection()] });

    expect(await screen.findByRole('link', { name: /Settings/ })).toBeInTheDocument();
  });
});
