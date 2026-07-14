/**
 * ErliDeliveryPriceListField tests (#1530)
 *
 * Covers the live per-connection fetch, the empty-state direction copy, the
 * options render, and the `onChange` contract (selecting by price-list name).
 */
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, createMockApiClient } from '../../../../test/test-utils';
import { ErliDeliveryPriceListField } from './erli-delivery-price-list-field';

afterEach(() => {
  cleanup();
});

describe('ErliDeliveryPriceListField', () => {
  it('renders the fetched delivery price lists as options', async () => {
    const apiClient = createMockApiClient({
      listings: {
        getDeliveryPriceLists: vi.fn().mockResolvedValue({
          deliveryPriceLists: [
            { id: '1', name: '*' },
            { id: '2', name: 'Kurier' },
          ],
        }),
      },
    });

    renderWithProviders(
      <ErliDeliveryPriceListField connectionId="conn_erli_1" value="" onChange={vi.fn()} />,
      { apiClient },
    );

    expect(await screen.findByRole('option', { name: 'Kurier' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '*' })).toBeInTheDocument();
  });

  it('shows a directive empty state when the account has no delivery price lists', async () => {
    const apiClient = createMockApiClient({
      listings: {
        getDeliveryPriceLists: vi.fn().mockResolvedValue({ deliveryPriceLists: [] }),
      },
    });

    renderWithProviders(
      <ErliDeliveryPriceListField connectionId="conn_erli_1" value="" onChange={vi.fn()} />,
      { apiClient },
    );

    expect(await screen.findByText(/No delivery price lists found on this Erli account/i)).toBeInTheDocument();
  });

  it('calls onChange with the selected price-list name', async () => {
    const onChange = vi.fn();
    const apiClient = createMockApiClient({
      listings: {
        getDeliveryPriceLists: vi.fn().mockResolvedValue({
          deliveryPriceLists: [{ id: '2', name: 'Kurier' }],
        }),
      },
    });

    renderWithProviders(
      <ErliDeliveryPriceListField connectionId="conn_erli_1" value="" onChange={onChange} />,
      { apiClient },
    );

    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'Kurier' } });

    expect(onChange).toHaveBeenCalledWith('Kurier');
  });
});
