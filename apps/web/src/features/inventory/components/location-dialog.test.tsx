import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import { LocationDialog } from './location-dialog';
import type { InventoryLocation } from '../api/inventory-locations.types';

const editTarget: InventoryLocation = {
  id: 'ol_location_1',
  code: 'WH1',
  name: 'Main warehouse',
  kind: 'warehouse',
  ownerConnectionId: null,
  externalRef: null,
  status: 'active',
  countryIso2: null,
  postcode: null,
  latitude: null,
  longitude: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('LocationDialog', () => {
  afterEach(cleanup);

  it('should render the create form with a Code field and empty defaults', async () => {
    renderWithProviders(<LocationDialog target={{ mode: 'create' }} onClose={() => undefined} />);

    expect(await screen.findByText('Add location')).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toHaveValue('');
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('should render the edit form pre-filled and without a Code field', async () => {
    renderWithProviders(
      <LocationDialog target={{ mode: 'edit', location: editTarget }} onClose={() => undefined} />,
    );

    expect(await screen.findByText('Edit "Main warehouse"')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Main warehouse');
    // UpdateLocationDto has no `code` — the edit form must not offer it.
    expect(screen.queryByLabelText('Code')).not.toBeInTheDocument();
  });

  it('should show validation errors after an empty create submit', async () => {
    renderWithProviders(<LocationDialog target={{ mode: 'create' }} onClose={() => undefined} />);
    await screen.findByText('Add location');

    await userEvent.click(screen.getByRole('button', { name: /save location/i }));

    expect((await screen.findAllByText('Code is required')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Name is required')).length).toBeGreaterThan(0);
  });

  it('should create with the mapped input and close on success', async () => {
    const createLocation = vi.fn().mockResolvedValue(editTarget);
    const apiClient = createMockApiClient({
      inventory: { createLocation },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });
    const onClose = vi.fn();
    renderWithProviders(<LocationDialog target={{ mode: 'create' }} onClose={onClose} />, { apiClient });
    await screen.findByText('Add location');

    await userEvent.type(screen.getByLabelText('Code'), 'wh1');
    await userEvent.type(screen.getByLabelText('Name'), 'Overflow');
    await userEvent.click(screen.getByRole('button', { name: /save location/i }));

    await waitFor(() =>
      expect(createLocation).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'WH1', name: 'Overflow', kind: 'warehouse', ownerConnectionId: null }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('should map a 409 duplicate-code response to a field error and keep the dialog open', async () => {
    const createLocation = vi
      .fn()
      .mockRejectedValue(new ApiError('Inventory location code already exists: WH1', 409, {}));
    const apiClient = createMockApiClient({
      inventory: { createLocation },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });
    const onClose = vi.fn();
    renderWithProviders(<LocationDialog target={{ mode: 'create' }} onClose={onClose} />, { apiClient });
    await screen.findByText('Add location');

    await userEvent.type(screen.getByLabelText('Code'), 'WH1');
    await userEvent.type(screen.getByLabelText('Name'), 'Overflow');
    await userEvent.click(screen.getByRole('button', { name: /save location/i }));

    expect(
      (await screen.findAllByText('Inventory location code already exists: WH1')).length,
    ).toBeGreaterThan(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('should update with the mapped patch, omitting code', async () => {
    const updateLocation = vi.fn().mockResolvedValue(editTarget);
    const apiClient = createMockApiClient({
      inventory: { updateLocation },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });
    const onClose = vi.fn();
    renderWithProviders(
      <LocationDialog target={{ mode: 'edit', location: editTarget }} onClose={onClose} />,
      { apiClient },
    );
    await screen.findByText('Edit "Main warehouse"');

    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), 'Renamed warehouse');
    await userEvent.click(screen.getByRole('button', { name: /save location/i }));

    await waitFor(() =>
      expect(updateLocation).toHaveBeenCalledWith(
        'ol_location_1',
        expect.objectContaining({ name: 'Renamed warehouse', kind: 'warehouse' }),
      ),
    );
    const [, patch] = updateLocation.mock.calls[0] as [string, Record<string, unknown>];
    expect('code' in patch).toBe(false);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
