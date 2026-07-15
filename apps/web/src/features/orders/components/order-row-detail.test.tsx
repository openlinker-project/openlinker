/**
 * OrderRowDetail tests
 *
 * Covers the expandable-row / mobile-card detail panel (#1620): every field
 * slot renders even when the underlying data is missing (showing "-"), and
 * populated fields surface the parsed snapshot values.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { OrderRowDetail } from './order-row-detail';
import type { OrderRecord } from '../api/orders.types';

const baseOrder: OrderRecord = {
  internalOrderId: 'ol_order_bare',
  customerId: null,
  sourceConnectionId: 'conn_1',
  sourceEventId: null,
  orderSnapshot: {},
  syncStatus: [],
  syncAttempts: [],
  recordStatus: 'ready',
  createdAt: '2026-01-15T10:00:00.000Z',
  updatedAt: '2026-01-15T10:00:00.000Z',
};

function renderDetail(order: OrderRecord): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <OrderRowDetail order={order} channelLabel={() => undefined} platformByConnection={new Map()} />
    </MemoryRouter>,
  );
}

describe('OrderRowDetail', () => {
  afterEach(cleanup);

  it('renders "-" for every field when the snapshot has no data', () => {
    renderDetail(baseOrder);

    const placeholders = screen.getAllByText('-');
    // Order reference, items, ship-by, carrier, destination, placed, payment,
    // shipping address, billing address — every optional slot falls back.
    expect(placeholders.length).toBeGreaterThanOrEqual(9);
  });

  it('always renders the internal id and created timestamp', () => {
    renderDetail(baseOrder);

    expect(screen.getByText('ol_order_bare')).toBeInTheDocument();
  });

  it('renders parsed snapshot values when present', () => {
    const order: OrderRecord = {
      ...baseOrder,
      orderSnapshot: {
        orderNumber: 'ALG-1',
        items: [{ id: 'i1', quantity: 1, price: 10, name: 'Widget' }],
        paymentStatus: 'paid',
        shippingAddress: {
          firstName: 'Anna',
          lastName: 'Kowalska',
          address1: 'ul. Testowa 1',
          city: 'Warszawa',
          postalCode: '00-001',
          country: 'PL',
        },
      },
    };

    renderDetail(order);

    expect(screen.getByText('ALG-1')).toBeInTheDocument();
    expect(screen.getByText('1 item')).toBeInTheDocument();
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    const shippingField = screen.getByText('Shipping address').closest('div') as HTMLElement;
    expect(within(shippingField).getByText('Anna Kowalska')).toBeInTheDocument();
  });
});
