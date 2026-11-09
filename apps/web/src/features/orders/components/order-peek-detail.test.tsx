import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { OrderRecord } from '../api/orders.types';
import { OrderPeekDetail } from './order-peek-detail';

const order: OrderRecord = {
  internalOrderId: 'ol_order_1',
  customerId: 'ol_customer_1',
  sourceConnectionId: 'conn_allegro_1',
  sourceEventId: null,
  orderSnapshot: {
    orderNumber: 'ALG-1',
    items: [
      {
        id: 'i1',
        quantity: 2,
        price: 10,
        name: 'Mapped Mug',
        sku: 'MUG-1',
        productId: 'ol_product_mug',
      },
      { id: 'i2', quantity: 1, price: 5, name: 'Loose Line', sku: 'LOOSE-1' },
    ],
    totals: { subtotal: 25, tax: 0, shipping: 0, total: 25, currency: 'PLN' },
  },
  syncStatus: [],
  syncAttempts: [],
  recordStatus: 'ready',
  createdAt: '2026-01-15T10:00:00.000Z',
  updatedAt: '2026-01-15T10:00:00.000Z',
};

function renderDetail(onOpenProduct = vi.fn()): { onOpenProduct: ReturnType<typeof vi.fn> } {
  renderWithProviders(
    <OrderPeekDetail order={order} thumbLabel="A" onOpenProduct={onOpenProduct} />,
    {
      apiClient: createMockApiClient(),
    }
  );
  return { onOpenProduct };
}

describe('OrderPeekDetail', () => {
  it('should open the product when its line is clicked', async () => {
    const { onOpenProduct } = renderDetail();
    await userEvent.click(screen.getByText('Mapped Mug'));
    expect(onOpenProduct).toHaveBeenCalledWith('ol_product_mug');
  });

  it('should open the product from the keyboard through the line button', async () => {
    const { onOpenProduct } = renderDetail();
    const button = screen.getByRole('button', { name: 'Open product Mapped Mug' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpenProduct).toHaveBeenCalledWith('ol_product_mug');
  });

  it('should keep an unmapped line inert and say why', async () => {
    const { onOpenProduct } = renderDetail();
    await userEvent.click(screen.getByText('Loose Line'));
    expect(onOpenProduct).not.toHaveBeenCalled();
    const row = screen.getByText('Loose Line').closest('tr');
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLElement).getByText('Not linked to a catalogue product yet')
    ).toBeInTheDocument();
    expect(within(row as HTMLElement).queryByRole('button')).toBeNull();
  });

  it('should total each line from its quantity and price', () => {
    renderDetail();
    const row = screen.getByText('Mapped Mug').closest('tr') as HTMLElement;
    expect(within(row).getByText(/20[.,]00/)).toBeInTheDocument();
  });
});
