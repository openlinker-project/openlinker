import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
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

function page(items: InventoryLocation[] = [location]): PaginatedInventoryLocations {
  return { items, total: items.length, page: 1, limit: 25 };
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

  it('turning the Show retired toggle off filters to status=active', async () => {
    const listLocations = vi.fn().mockResolvedValue(page());
    const apiClient = createMockApiClient({ inventory: { listLocations } });
    renderWithProviders(<InventoryLocationsPage />, { apiClient });

    await screen.findByText('Warsaw — Main warehouse');
    await userEvent.click(screen.getByRole('checkbox', { name: /show retired/i }));

    await waitFor(() =>
      expect(listLocations).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'active' }),
        undefined,
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
        undefined,
      ),
    );
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
});
