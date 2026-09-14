import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import { LocationDeleteDialog } from './location-delete-dialog';
import type { InventoryLocation } from '../api/inventory-locations.types';

const target: InventoryLocation = {
  id: 'ol_location_1',
  code: 'KRK-OVF',
  name: 'Kraków — Overflow',
  kind: 'warehouse',
  ownerConnectionId: null,
  externalRef: null,
  status: 'active',
  countryIso2: 'PL',
  postcode: '30-001',
  latitude: null,
  longitude: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('LocationDeleteDialog', () => {
  afterEach(cleanup);

  it('should render nothing (closed) when location is null', () => {
    renderWithProviders(<LocationDeleteDialog location={null} onClose={() => undefined} />);

    expect(screen.queryByText(/delete/i)).not.toBeInTheDocument();
  });

  it('should delete and close on success when nothing references the location', async () => {
    const deleteLocation = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ inventory: { deleteLocation } });
    const onClose = vi.fn();
    renderWithProviders(<LocationDeleteDialog location={target} onClose={onClose} />, { apiClient });

    await screen.findByText('Delete "Kraków — Overflow"?');
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(deleteLocation).toHaveBeenCalledWith('ol_location_1'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('should switch to the in-use explanation on a 409 and offer Retire instead', async () => {
    const deleteLocation = vi
      .fn()
      .mockRejectedValue(
        new ApiError('Inventory location ol_location_1 is referenced by 3 inventory position(s)', 409, {}),
      );
    const apiClient = createMockApiClient({ inventory: { deleteLocation } });
    renderWithProviders(<LocationDeleteDialog location={target} onClose={() => undefined} />, { apiClient });

    await screen.findByText('Delete "Kraków — Overflow"?');
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(await screen.findByText('Can\'t delete "Kraków — Overflow"')).toBeInTheDocument();
    expect(screen.getByText('Stock positions still point here, so the delete was refused.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retire instead/i })).toBeInTheDocument();
    // A refused delete never renders the raw domain error as a second, generic alert.
    expect(
      screen.queryByText('Inventory location ol_location_1 is referenced by 3 inventory position(s)'),
    ).not.toBeInTheDocument();
  });

  it('should retire successfully from the in-use state and close', async () => {
    const deleteLocation = vi
      .fn()
      .mockRejectedValue(new ApiError('Inventory location ol_location_1 is referenced by 3 inventory position(s)', 409, {}));
    const updateLocation = vi.fn().mockResolvedValue({ ...target, status: 'inactive' });
    const apiClient = createMockApiClient({ inventory: { deleteLocation, updateLocation } });
    const onClose = vi.fn();
    renderWithProviders(<LocationDeleteDialog location={target} onClose={onClose} />, { apiClient });

    await screen.findByText('Delete "Kraków — Overflow"?');
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await screen.findByRole('button', { name: /retire instead/i });

    await userEvent.click(screen.getByRole('button', { name: /retire instead/i }));

    await waitFor(() =>
      expect(updateLocation).toHaveBeenCalledWith('ol_location_1', { status: 'inactive' }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  // Tech-review finding: the `genericError` ternary — the component's only
  // logic for surfacing a real infra/5xx failure — had zero coverage. Every
  // prior test exercised either success or the mapped 409, never the branch
  // this dialog falls back to for everything else.
  it('shows a generic error alert on a non-conflict delete failure, and stays in the confirm phase', async () => {
    const deleteLocation = vi.fn().mockRejectedValue(new ApiError('Internal server error', 500, {}));
    const apiClient = createMockApiClient({ inventory: { deleteLocation } });
    renderWithProviders(<LocationDeleteDialog location={target} onClose={() => undefined} />, { apiClient });

    await screen.findByText('Delete "Kraków — Overflow"?');
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(await screen.findByText('Could not save the location')).toBeInTheDocument();
    expect(screen.getByText('Internal server error')).toBeInTheDocument();
    // A 5xx is not a mapped conflict, so the dialog must not silently switch
    // to the retire flow — that would hide the real failure behind an
    // unrelated affordance.
    expect(screen.queryByRole('button', { name: /retire instead/i })).not.toBeInTheDocument();
    expect(screen.getByText('Delete "Kraków — Overflow"?')).toBeInTheDocument();
  });

  it('shows a generic error alert when the retire (update) call itself fails from the in-use state', async () => {
    const deleteLocation = vi
      .fn()
      .mockRejectedValue(new ApiError('Inventory location ol_location_1 is referenced by 3 inventory position(s)', 409, {}));
    const updateLocation = vi.fn().mockRejectedValue(new ApiError('Internal server error', 500, {}));
    const apiClient = createMockApiClient({ inventory: { deleteLocation, updateLocation } });
    const onClose = vi.fn();
    renderWithProviders(<LocationDeleteDialog location={target} onClose={onClose} />, { apiClient });

    await screen.findByText('Delete "Kraków — Overflow"?');
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await screen.findByRole('button', { name: /retire instead/i });

    await userEvent.click(screen.getByRole('button', { name: /retire instead/i }));

    expect(await screen.findByText('Could not save the location')).toBeInTheDocument();
    expect(screen.getByText('Internal server error')).toBeInTheDocument();
    // The dialog stays open in the in-use phase so the operator can retry —
    // a failed retire must not silently close the dialog or drop them back
    // to the "Delete?" confirm they already got past.
    expect(screen.getByRole('button', { name: /retire instead/i })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('should reset to the confirm phase when reopened for a different location', async () => {
    const deleteLocation = vi
      .fn()
      .mockRejectedValue(new ApiError('Inventory location ol_location_1 is referenced by 3 inventory position(s)', 409, {}));
    const apiClient = createMockApiClient({ inventory: { deleteLocation } });
    const { rerender } = renderWithProviders(
      <LocationDeleteDialog location={target} onClose={() => undefined} />,
      { apiClient },
    );

    await screen.findByText('Delete "Kraków — Overflow"?');
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await screen.findByRole('button', { name: /retire instead/i });

    const other: InventoryLocation = { ...target, id: 'ol_location_2', name: 'Gdańsk — Flagship store' };
    rerender(<LocationDeleteDialog location={other} onClose={() => undefined} />);

    expect(await screen.findByText('Delete "Gdańsk — Flagship store"?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retire instead/i })).not.toBeInTheDocument();
  });
});
