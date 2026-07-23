/**
 * OrderRowDetail tests
 *
 * Covers the expandable-row / mobile-card detail panel (#1620, regrouped #1713):
 * the long-form field slots fall back to "-" when data is missing, populated
 * fields surface the parsed snapshot values, the "Open order" links render, and
 * the itemised line list shows one row per item.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleProvider } from '../../../shared/i18n';
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
    <LocaleProvider>
      <MemoryRouter>
        <OrderRowDetail
          order={order}
          channelLabel={() => undefined}
          platformByConnection={new Map()}
        />
      </MemoryRouter>
    </LocaleProvider>,
  );
}

describe('OrderRowDetail', () => {
  afterEach(cleanup);

  it('renders "-" for every empty long-form field when the snapshot has no data', () => {
    renderDetail(baseOrder);

    const placeholders = screen.getAllByText('-');
    // Order reference, placed, destination, ship-by, items, shipping address,
    // billing address — every optional slot falls back (internal id always shows).
    expect(placeholders.length).toBeGreaterThanOrEqual(6);
  });

  it('renders an "est." qualifier on the Ship-by field only when the deadline is estimated (#1776)', () => {
    const { rerender } = renderDetail({
      ...baseOrder,
      dispatchByAt: '2026-02-01T12:00:00.000Z',
      dispatchByEstimated: true,
    });
    expect(screen.getByLabelText('Estimated')).toBeInTheDocument();

    rerender(
      <LocaleProvider>
        <MemoryRouter>
          <OrderRowDetail
            order={{
              ...baseOrder,
              dispatchByAt: '2026-02-01T12:00:00.000Z',
              dispatchByEstimated: false,
            }}
            channelLabel={() => undefined}
            platformByConnection={new Map()}
          />
        </MemoryRouter>
      </LocaleProvider>,
    );
    expect(screen.queryByLabelText('Estimated')).not.toBeInTheDocument();
  });

  it('always renders the internal id and the OpenLinker order-details link', () => {
    renderDetail(baseOrder);

    expect(screen.getByText('ol_order_bare')).toBeInTheDocument();
    const detailsLink = screen.getByRole('link', { name: /order details/i });
    expect(detailsLink).toHaveAttribute('href', '/orders/ol_order_bare');
  });

  it('renders the source deep link when the snapshot carries a sourceExternalUrl', () => {
    const order: OrderRecord = {
      ...baseOrder,
      orderSnapshot: { sourceExternalUrl: 'https://salescenter.allegro.pl/orders/abc' },
    };

    renderDetail(order);

    const sourceLink = screen.getByRole('link', { name: /view on/i });
    expect(sourceLink).toHaveAttribute('href', 'https://salescenter.allegro.pl/orders/abc');
    expect(sourceLink).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('renders parsed snapshot values and an itemised line list when present', () => {
    const order: OrderRecord = {
      ...baseOrder,
      orderSnapshot: {
        orderNumber: 'ALG-1',
        totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
        items: [{ id: 'i1', quantity: 2, price: 10, name: 'Widget', sku: 'SKU-1' }],
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
    expect(screen.getByText('Items (1)')).toBeInTheDocument();
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('SKU-1')).toBeInTheDocument();
    expect(screen.getByText('2×')).toBeInTheDocument();
    const shippingField = screen.getByText('Shipping address').closest('div') as HTMLElement;
    expect(within(shippingField).getByText('Anna Kowalska')).toBeInTheDocument();
  });
});
