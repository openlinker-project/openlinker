/**
 * Sourcing rules page (#3060)
 *
 * The page owns two gates and nothing else, so this file asserts exactly those
 * two — and that neither of them is reported while the reads are still in
 * flight or after one failed, which would state something about the operator's
 * configuration from a network problem.
 *
 * The gate cases are told apart by CAUSE, so all three combinations are here:
 * no OMS connection, a named connection that is not the OMS one, and a named
 * connection on an install that has no OMS connection at all — the last being
 * the one a param-presence test would get wrong.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import { ApiError } from '../../shared/api/api-error';
import { SourcingRulesPage } from './sourcing-rules-page';

interface ConnectionLike {
  id: string;
  platformType: string;
}

function omsConnection(id = 'conn_oms'): ConnectionLike {
  return { id, platformType: 'openlinker' };
}

const ACTIVE_LOCATION = { id: 'loc_a', code: 'MAIN', name: 'Main warehouse', status: 'active' };

function renderPage(options: {
  connections?: unknown;
  connectionsError?: unknown;
  /** The picker's full-status page. */
  locations?: unknown;
  /** What the picker's page claims the server holds, for the truncation notice. */
  locationsTotal?: number;
  /** The gate's own probe — deliberately separate from the picker's page. */
  activeLocationTotal?: number;
  bootstrap?: ReturnType<typeof vi.fn>;
  search?: string;
  admin?: boolean;
}): void {
  const items = (options.locations ?? []) as unknown[];
  const apiClient = createMockApiClient({
    connections: {
      list:
        options.connectionsError === undefined
          ? vi.fn().mockResolvedValue(options.connections ?? [])
          : vi.fn().mockRejectedValue(options.connectionsError),
    } as never,
    inventory: {
      listLocations: vi.fn().mockResolvedValue({
        items,
        total: options.locationsTotal ?? items.length,
        page: 1,
        limit: 200,
      }),
      listActiveLocations: vi
        .fn()
        .mockResolvedValue({ items: [], total: options.activeLocationTotal ?? 0, page: 1, limit: 1 }),
      ...(options.bootstrap === undefined ? {} : { bootstrapLocations: options.bootstrap }),
    } as never,
    sourcingRules: { list: vi.fn().mockResolvedValue([]) } as never,
  });

  renderWithProviders(<SourcingRulesPage />, {
    apiClient,
    route: `/settings/sourcing-rules${options.search ?? ''}`,
    ...(options.admin === true ? { sessionAdapter: createAuthenticatedSessionAdapter() } : {}),
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
      locations: [ACTIVE_LOCATION],
      activeLocationTotal: 1,
    });

    // A ruleset authored here would never be read: the backend refuses
    // authoring on anything but the OMS connection.
    expect(
      await screen.findByText('This is not your OpenLinker OMS connection')
    ).toBeInTheDocument();
  });

  it('says the OMS is not enabled even when a connection id was named, if there is no OMS connection', async () => {
    // The cause, not the presence of a query param, picks the copy: with no OMS
    // connection on the install there was nothing to compare the named id
    // against, so "this is not your OMS connection" would describe a comparison
    // that never happened.
    renderPage({
      connections: [{ id: 'conn_shop', platformType: 'prestashop' }],
      search: '?connectionId=conn_shop',
    });

    expect(await screen.findByText('The OpenLinker OMS is not enabled')).toBeInTheDocument();
    expect(screen.queryByText('This is not your OpenLinker OMS connection')).toBeNull();
  });

  it('gates on the ACTIVE-location probe, not on the picker page', async () => {
    // The picker reads one capped page of EVERY status. Counting active rows
    // inside it would refuse authoring on an install whose first page happens
    // to be all retired, while active locations exist further down.
    renderPage({
      connections: [omsConnection()],
      locations: [{ id: 'loc_a', code: 'OLD', name: 'Retired depot', status: 'inactive' }],
      activeLocationTotal: 0,
    });

    expect(await screen.findByText('No locations to route to yet')).toBeInTheDocument();
  });

  it('opens the editor when the probe finds an active location the picker page does not show', async () => {
    renderPage({
      connections: [omsConnection()],
      locations: [{ id: 'loc_a', code: 'OLD', name: 'Retired depot', status: 'inactive' }],
      activeLocationTotal: 3,
    });

    expect(
      await screen.findByText('Nothing decides where an order ships from yet')
    ).toBeInTheDocument();
  });

  it('offers the location bootstrap rather than a link to a screen that does not exist', async () => {
    // #2407 designed `POST /inventory/locations/bootstrap` as exactly this
    // offer. There is no locations screen yet, so a "Manage locations" link
    // would land the operator back where they started.
    const bootstrap = vi.fn().mockResolvedValue({ created: [ACTIVE_LOCATION], existingCodes: [] });
    renderPage({ connections: [omsConnection()], bootstrap, admin: true });

    await userEvent.click(await screen.findByRole('button', { name: 'Create a location' }));

    await waitFor(() => {
      expect(bootstrap).toHaveBeenCalledTimes(1);
    });
    // Says what it does NOT do: a minted location holds no stock.
    expect(screen.getByText(/stock still has to be assigned to it/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manage locations' })).toBeNull();
  });

  it('hides the bootstrap for a session that cannot create a location, and says why', async () => {
    renderPage({ connections: [omsConnection()] });

    expect(await screen.findByText('No locations to route to yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create a location' })).toBeNull();
    expect(screen.getByText(/requires an administrator account/)).toBeInTheDocument();
  });

  it('renders the section once both gates pass', async () => {
    renderPage({
      connections: [omsConnection()],
      locations: [ACTIVE_LOCATION],
      activeLocationTotal: 1,
    });

    expect(
      await screen.findByText('Nothing decides where an order ships from yet')
    ).toBeInTheDocument();
  });

  it('states that the picker page is truncated rather than letting it pass unremarked', async () => {
    // A bounded read that reports healthy while being half-complete is the
    // failure mode, not the bound (ADR-048 decision 5).
    renderPage({
      connections: [omsConnection()],
      locations: [ACTIVE_LOCATION],
      locationsTotal: 260,
      activeLocationTotal: 260,
    });

    expect(await screen.findByText('Not every location is listed')).toBeInTheDocument();
    expect(screen.getByText(/Showing 1 of 260 locations/)).toBeInTheDocument();
  });

  it('says nothing about truncation when the page holds everything', async () => {
    renderPage({
      connections: [omsConnection()],
      locations: [ACTIVE_LOCATION],
      activeLocationTotal: 1,
    });

    await screen.findByText('Nothing decides where an order ships from yet');
    expect(screen.queryByText('Not every location is listed')).toBeNull();
  });

  it('links back to settings, because the tile is the only way in', async () => {
    renderPage({ connections: [omsConnection()] });

    expect(await screen.findByRole('link', { name: /Settings/ })).toBeInTheDocument();
  });
});
