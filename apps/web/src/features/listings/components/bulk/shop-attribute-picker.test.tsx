/**
 * ShopAttributePicker tests (#1835)
 *
 * Covers global-attribute selection + term picking (emits an OfferParameter with
 * valuesIds), the custom free-text fallback (no valuesIds), and the no-global-
 * attributes empty state.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders, createMockApiClient } from '../../../../test/test-utils';
import { ShopAttributePicker } from './shop-attribute-picker';
import type { ShopAttribute, ShopAttributeTerm } from '../../api/listings.types';

const ATTRIBUTES: ShopAttribute[] = [
  { id: '6', name: 'Color', slug: 'pa_color' },
  { id: '7', name: 'Size', slug: 'pa_size' },
];
const COLOR_TERMS: ShopAttributeTerm[] = [
  { id: '31', name: 'Red', slug: 'red' },
  { id: '32', name: 'Blue', slug: 'blue' },
];

function mockApi(attributes: ShopAttribute[] = ATTRIBUTES) {
  return createMockApiClient({
    listings: {
      listShopAttributes: vi.fn().mockResolvedValue(attributes),
      listShopAttributeTerms: vi.fn().mockResolvedValue(COLOR_TERMS),
    },
  });
}

describe('ShopAttributePicker', () => {
  it('emits a global-attribute parameter with term names + term ids', async () => {
    const onAdd = vi.fn();
    renderWithProviders(<ShopAttributePicker connectionId="conn-1" onAdd={onAdd} />, {
      apiClient: mockApi(),
    });

    // Attribute select appears once attributes load.
    const select = await screen.findByLabelText('Attribute');
    await userEvent.selectOptions(select, '6');

    await userEvent.click(await screen.findByLabelText('Red'));
    await userEvent.click(screen.getByRole('button', { name: 'Add attribute' }));

    expect(onAdd).toHaveBeenCalledWith({
      id: '6',
      values: ['Red'],
      valuesIds: ['31'],
      section: 'product',
    });
  });

  it('emits a custom free-text parameter without valuesIds', async () => {
    const onAdd = vi.fn();
    renderWithProviders(<ShopAttributePicker connectionId="conn-1" onAdd={onAdd} />, {
      apiClient: mockApi(),
    });

    await userEvent.click(await screen.findByRole('radio', { name: 'Custom' }));

    await userEvent.type(screen.getByLabelText('Name'), 'Material');
    await userEvent.type(screen.getByLabelText('Values'), 'Cotton, Wool');
    await userEvent.click(screen.getByRole('button', { name: 'Add attribute' }));

    expect(onAdd).toHaveBeenCalledWith({
      id: 'Material',
      values: ['Cotton', 'Wool'],
      section: 'product',
    });
  });

  it('shows an empty state when the shop has no global attributes', async () => {
    renderWithProviders(<ShopAttributePicker connectionId="conn-1" onAdd={vi.fn()} />, {
      apiClient: mockApi([]),
    });

    expect(await screen.findByText(/no global attributes/i)).toBeInTheDocument();
  });
});
