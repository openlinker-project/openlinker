import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import { ApiError } from '../../shared/api/api-error';
import { InventoryLocationsPage } from './inventory-locations-page';
import type { InventoryLocation, PaginatedInventoryLocations } from '../../features/inventory';

const location: InventoryLocation = {
  id: 'ol_location_1',
  code: 'MAIN',
  name: 'Warsaw — Main warehouse',
  kind: 'warehouse',
  ownerConnectionId: null,
  externalRef: null,
  status: 'active',
  countryIso2: 'PL',
  postcode: '02-677',
  latitude: null,
  longitude: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function page(
  items: InventoryLocation[] = [location],
  overrides: Partial<Pick<PaginatedInventoryLocations, 'total' | 'page' | 'limit'>> = {},
): PaginatedInventoryLocations {
  return { items, total: items.length, page: 1, limit: 25, ...overrides };
}

describe('InventoryLocationsPage', () => {
  afterEach(cleanup);

  it('renders the page heading', () => {
    const apiClient = createMockApiClient({ inventory: { listLocations: vi.fn().mockResolvedValue(page([])) } });
    renderWithProviders(<InventoryLocationsPage />, { apiClient });
    expect(screen.getByRole('heading', { name: 'Inventory locations' })).toBeInTheDocument();
  });

  it('renders the kind filter and a Show retired toggle, checked by default', async () => {
    const apiClient = createMockApiClient({ inventory: { listLocations: vi.fn().mockResolvedValue(page()) } });
    renderWithProviders(<InventoryLocationsPage />, { apiClient });

    expect(await screen.findByRole('combobox', { name: 'Filter by kind' })).toBeInTheDocument();
    const toggle = screen.getByRole('checkbox', { name: /show retired/i });
    expect(toggle).toBeChecked();
  });

  it('displays locations returned by the API', async () => {
    const apiClient = createMockApiClient({ inventory: { listLocations: vi.fn().mockResolvedValue(page()) } });
    renderWithProviders(<InventoryLocationsPage />, { apiClient });

    expect(await screen.findByText('Warsaw — Main warehouse')).toBeInTheDocument();
  });

  it('shows loading state while fetching', () => {
    const apiClient = createMockApiClient({
      inventory: { listLocations: vi.fn().mockReturnValue(new Promise(() => {})) },
    });
    renderWithProviders(<InventoryLocationsPage />, { apiClient });

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows an error state when the fetch fails', async () => {
    const apiClient = createMockApiClient({
      inventory: { listLocations: vi.fn().mockRejectedValue(new Error('Network error')) },
    });
    renderWithProviders(<InventoryLocationsPage />, { apiClient });

    expect(await screen.findByRole('heading', { name: "Couldn't load locations" })).toBeInTheDocument();
  });

  it('shows the pre-bootstrap empty state with write access', async () => {
    const apiClient = createMockApiClient({ inventory: { listLocations: vi.fn().mockResolvedValue(page([])) } });
    renderWithProviders(<InventoryLocationsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByRole('heading', { name: 'Routing has nowhere to source stock from' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create first location' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add manually' })).toBeInTheDocument();
  });

  // Regression: useBootstrapLocationsMutation used to invalidate only
  // activeLocations() (the #2407 readiness-panel key), so a successful
  // bootstrap here left the list's own locations() query stale — the click
  // visibly did nothing until a full page reload re-fetched it.
  it('the newly-minted location appears without a page reload after Create first location', async () => {
    const created = { ...location, id: 'ol_location_main' };
    const listLocations = vi
      .fn()
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([created]));
    const bootstrapLocations = vi
      .fn()
      .mockResolvedValue({ created: [created], existingCodes: [] });
    const apiClient = createMockApiClient({ inventory: { listLocations, bootstrapLocations } });
    renderWithProviders(<InventoryLocationsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Create first location' }));

    expect(await screen.findByText('Warsaw — Main warehouse')).toBeInTheDocument();
    expect(listLocations).toHaveBeenCalledTimes(2);
  });

  it('turning the Show retired toggle off filters to status=active', async () => {
    const listLocations = vi.fn().mockResolvedValue(page());
    const apiClient = createMockApiClient({ inventory: { listLocations } });
    renderWithProviders(<InventoryLocationsPage />, { apiClient });

    await screen.findByText('Warsaw — Main warehouse');
    await userEvent.click(screen.getByRole('checkbox', { name: /show retired/i }));

    await waitFor(() =>
      expect(listLocations).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'active' }),
        { page: 1, limit: 25 },
      ),
    );
  });

  it('changing the kind filter narrows the list query', async () => {
    const listLocations = vi.fn().mockResolvedValue(page());
    const apiClient = createMockApiClient({ inventory: { listLocations } });
    renderWithProviders(<InventoryLocationsPage />, { apiClient });

    await screen.findByText('Warsaw — Main warehouse');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by kind' }), 'warehouse');

    await waitFor(() =>
      expect(listLocations).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: 'warehouse' }),
        { page: 1, limit: 25 },
      ),
    );
  });

  // #3135 review — pagination was silently dropped: the query never received
  // a `pagination` argument and `total` was never read anywhere on the page.
  describe('pagination (tech-lead review fix)', () => {
    it('does not render a pager when everything fits on one page', async () => {
      const apiClient = createMockApiClient({
        inventory: { listLocations: vi.fn().mockResolvedValue(page([location], { total: 1 })) },
      });
      renderWithProviders(<InventoryLocationsPage />, { apiClient });

      await screen.findByText('Warsaw — Main warehouse');
      expect(screen.queryByText(/page 1 of/i)).not.toBeInTheDocument();
    });

    it('renders the pager and disables Previous on the first page, when total exceeds one page', async () => {
      const apiClient = createMockApiClient({
        inventory: { listLocations: vi.fn().mockResolvedValue(page([location], { total: 30 })) },
      });
      renderWithProviders(<InventoryLocationsPage />, { apiClient });

      await screen.findByText('Warsaw — Main warehouse');
      expect(screen.getByText('Page 1 of 2 · 30 locations')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    });

    it('clicking Next requests page 2 and enables Previous', async () => {
      const listLocations = vi.fn().mockResolvedValue(page([location], { total: 30 }));
      const apiClient = createMockApiClient({ inventory: { listLocations } });
      renderWithProviders(<InventoryLocationsPage />, { apiClient });

      await screen.findByText('Warsaw — Main warehouse');
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));

      // `MemoryRouter` doesn't sync to `window.location`, so the URL isn't a
      // reachable assertion here — the request args and the page's own
      // rendered pager state are: both are downstream of the same
      // `useSearchParams` change a real browser navigation would also drive.
      await waitFor(() =>
        expect(listLocations).toHaveBeenLastCalledWith(expect.anything(), { page: 2, limit: 25 }),
      );
      expect(await screen.findByText('Page 2 of 2 · 30 locations')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
    });

    it('changing a filter lands back on page 1', async () => {
      const listLocations = vi.fn().mockResolvedValue(page([location], { total: 30 }));
      const apiClient = createMockApiClient({ inventory: { listLocations } });
      renderWithProviders(<InventoryLocationsPage />, { apiClient, route: '/inventory/locations?page=2' });

      await screen.findByText('Warsaw — Main warehouse');
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by kind' }), 'warehouse');

      await waitFor(() =>
        expect(listLocations).toHaveBeenLastCalledWith(
          expect.objectContaining({ kind: 'warehouse' }),
          { page: 1, limit: 25 },
        ),
      );
      expect(await screen.findByText('Page 1 of 2 · 30 locations')).toBeInTheDocument();
    });
  });

  // #3135 review — the empty-state's "Create first location" / "+ Add
  // manually" buttons used the same `disabled={write.demoReadOnly}`
  // condition as every other write affordance on the page but skipped the
  // `ReadOnlyLock` wrapper, so a demo viewer got disabled buttons with no
  // explanatory tooltip there and there alone.
  it('wraps the empty-state write buttons in ReadOnlyLock for a demo read-only viewer', async () => {
    const viewerSession = createAuthenticatedSessionAdapter({
      id: 'u2',
      username: 'viewer',
      email: null,
      role: 'viewer',
      permissions: ['inventory:read'],
    });
    const apiClient = createMockApiClient({
      inventory: { listLocations: vi.fn().mockResolvedValue(page([], { total: 0 })) },
      system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
    });
    renderWithProviders(<InventoryLocationsPage />, { apiClient, sessionAdapter: viewerSession });

    const createFirst = await screen.findByRole('button', { name: 'Create first location' });
    const addManually = screen.getByRole('button', { name: '+ Add manually' });
    expect(createFirst.closest('.read-only-lock')).not.toBeNull();
    expect(addManually.closest('.read-only-lock')).not.toBeNull();
  });

  it('hides Edit/Delete row actions and Add location for a session with no write permission', async () => {
    const apiClient = createMockApiClient({ inventory: { listLocations: vi.fn().mockResolvedValue(page()) } });
    renderWithProviders(<InventoryLocationsPage />, { apiClient });

    await screen.findByText('Warsaw — Main warehouse');
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add location' })).not.toBeInTheDocument();
  });

  it('opens the create dialog from Add location, for a session with write access', async () => {
    const apiClient = createMockApiClient({ inventory: { listLocations: vi.fn().mockResolvedValue(page()) } });
    renderWithProviders(<InventoryLocationsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await userEvent.click(await screen.findByRole('button', { name: '+ Add location' }));

    expect(await screen.findByText('Add location')).toBeInTheDocument();
  });

  it('opens the edit dialog pre-filled from the row, for a session with write access', async () => {
    const apiClient = createMockApiClient({ inventory: { listLocations: vi.fn().mockResolvedValue(page()) } });
    renderWithProviders(<InventoryLocationsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(await screen.findByText('Edit "Warsaw — Main warehouse"')).toBeInTheDocument();
  });

  it('opens the delete-confirm dialog from the row, for a session with write access', async () => {
    const apiClient = createMockApiClient({ inventory: { listLocations: vi.fn().mockResolvedValue(page()) } });
    renderWithProviders(<InventoryLocationsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Delete "Warsaw — Main warehouse"?')).toBeInTheDocument();
  });

  // #3070 — end-to-end round trips through the real mutation hooks' cache
  // invalidation, not just "the dialog opened": every hook/dialog test above
  // stops at the request being made, so none of them prove the PAGE actually
  // reflects a successful write.
  describe('end-to-end CRUD round trips (#3070)', () => {
    it('create: the new row appears in the table after a successful submit', async () => {
      const created: InventoryLocation = { ...location, id: 'ol_location_2', code: 'WH2', name: 'Overflow' };
      const listLocations = vi
        .fn()
        .mockResolvedValueOnce(page([location]))
        .mockResolvedValueOnce(page([location, created]));
      const createLocation = vi.fn().mockResolvedValue(created);
      const apiClient = createMockApiClient({ inventory: { listLocations, createLocation } });
      renderWithProviders(<InventoryLocationsPage />, {
        apiClient,
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });

      await screen.findByText('Warsaw — Main warehouse');
      await userEvent.click(screen.getByRole('button', { name: '+ Add location' }));
      await screen.findByText('Add location');
      await userEvent.type(screen.getByLabelText('Code'), 'WH2');
      await userEvent.type(screen.getByLabelText('Name'), 'Overflow');
      await userEvent.click(screen.getByRole('button', { name: /save location/i }));

      expect(await screen.findByText('Overflow')).toBeInTheDocument();
      expect(listLocations).toHaveBeenCalledTimes(2);
    });

    it('delete: the row is gone from the table after a successful delete', async () => {
      const listLocations = vi
        .fn()
        .mockResolvedValueOnce(page([location]))
        .mockResolvedValueOnce(page([]));
      const deleteLocation = vi.fn().mockResolvedValue(undefined);
      const apiClient = createMockApiClient({ inventory: { listLocations, deleteLocation } });
      renderWithProviders(<InventoryLocationsPage />, {
        apiClient,
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });

      await screen.findByText('Warsaw — Main warehouse');
      await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await screen.findByText('Delete "Warsaw — Main warehouse"?');
      await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

      await waitFor(() => expect(screen.queryByText('Warsaw — Main warehouse')).not.toBeInTheDocument());
      expect(listLocations).toHaveBeenCalledTimes(2);
    });

    it('retire: a 409-refused delete, retired instead, flips the row to Retired', async () => {
      const listLocations = vi
        .fn()
        .mockResolvedValueOnce(page([location]))
        .mockResolvedValueOnce(page([{ ...location, status: 'inactive' }]));
      const deleteLocation = vi
        .fn()
        .mockRejectedValue(new ApiError('Inventory location ol_location_1 is referenced by 3 inventory position(s)', 409, {}));
      const updateLocation = vi.fn().mockResolvedValue({ ...location, status: 'inactive' });
      const apiClient = createMockApiClient({ inventory: { listLocations, deleteLocation, updateLocation } });
      renderWithProviders(<InventoryLocationsPage />, {
        apiClient,
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });

      await screen.findByText('Warsaw — Main warehouse');
      expect(screen.getByText('active')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await screen.findByText('Delete "Warsaw — Main warehouse"?');
      await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
      await screen.findByRole('button', { name: /retire instead/i });
      await userEvent.click(screen.getByRole('button', { name: /retire instead/i }));

      await waitFor(() => expect(screen.getByText('inactive')).toBeInTheDocument());
      expect(listLocations).toHaveBeenCalledTimes(2);
    });
  });
});
