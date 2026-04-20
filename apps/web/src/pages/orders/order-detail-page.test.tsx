import { cleanup, fireEvent, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../test/test-utils';
import { OrderDetailPage } from './order-detail-page';
import type { OrderRecord } from '../../features/orders/api/orders.types';

const sampleOrder: OrderRecord = {
  internalOrderId: 'ol_order_abc123',
  customerId: 'ol_customer_xyz',
  sourceConnectionId: sampleConnection.id,
  sourceEventId: 'evt_42',
  orderSnapshot: { lineItems: [{ sku: 'SKU-1', qty: 2 }] },
  syncStatus: [
    {
      destinationConnectionId: sampleConnection.id,
      status: 'synced',
      syncedAt: '2026-04-20T10:00:00.000Z',
      externalOrderId: '42',
      externalOrderNumber: null,
      error: null,
    },
  ],
  createdAt: '2026-04-20T09:00:00.000Z',
  updatedAt: '2026-04-20T10:00:00.000Z',
};

function renderDetail(apiClient: ReturnType<typeof createMockApiClient>): void {
  renderWithProviders(
    <Routes>
      <Route path="/orders/:internalOrderId" element={<OrderDetailPage />} />
    </Routes>,
    { apiClient, route: '/orders/ol_order_abc123' },
  );
}

describe('OrderDetailPage', () => {
  afterEach(cleanup);

  it('renders key order fields and resolves the source connection name', async () => {
    const api = createMockApiClient({
      orders: { getById: vi.fn().mockResolvedValue(sampleOrder) },
    });

    renderDetail(api);

    expect(await screen.findByText('ol_order_abc123')).toBeInTheDocument();
    expect(screen.getByText('ol_customer_xyz')).toBeInTheDocument();
    expect(screen.getByText('evt_42')).toBeInTheDocument();

    const links = await screen.findAllByRole('link', { name: sampleConnection.name });
    expect(links.length).toBeGreaterThan(0);
  });

  it('renders the order snapshot inside RawPayloadPanel (collapsed, expandable)', async () => {
    const api = createMockApiClient({
      orders: { getById: vi.fn().mockResolvedValue(sampleOrder) },
    });

    renderDetail(api);

    await screen.findByText('ol_order_abc123');

    expect(screen.getByText('Order Snapshot')).toBeInTheDocument();
    const expandButton = screen.getByRole('button', { name: 'Expand' });
    fireEvent.click(expandButton);
    expect(screen.getByLabelText('Payload content').textContent).toContain('SKU-1');
  });

  it('does not render the failed-destinations banner when every destination is synced', async () => {
    const api = createMockApiClient({
      orders: { getById: vi.fn().mockResolvedValue(sampleOrder) },
    });

    renderDetail(api);

    await screen.findByText('ol_order_abc123');
    expect(screen.queryByText(/destination.*failed/i)).toBeNull();
  });

  it('elevates failed destinations into an alert banner with retry action', async () => {
    const orderWithFailure: OrderRecord = {
      ...sampleOrder,
      syncStatus: [
        {
          destinationConnectionId: sampleConnection.id,
          status: 'failed',
          syncedAt: null,
          externalOrderId: null,
          externalOrderNumber: null,
          error: 'insert or update on table inventory_items violates foreign key constraint',
        },
      ],
    };

    const api = createMockApiClient({
      orders: { getById: vi.fn().mockResolvedValue(orderWithFailure) },
    });

    renderDetail(api);

    await screen.findByText('1 destination failed');
    expect(screen.getAllByText(/foreign key constraint/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'View failed orders' })).toHaveAttribute(
      'href',
      '/orders/failed',
    );
  });
});
