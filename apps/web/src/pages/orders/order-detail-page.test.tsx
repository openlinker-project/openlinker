import { cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  syncAttempts: [
    {
      destinationConnectionId: sampleConnection.id,
      status: 'synced',
      attemptedAt: '2026-04-20T10:00:00.000Z',
      error: null,
      externalOrderId: '42',
      externalOrderNumber: null,
    },
  ],
  recordStatus: 'ready',
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

    expect((await screen.findAllByText('ol_order_abc123')).length).toBeGreaterThan(0);
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
      `/orders/failed?connectionId=${sampleConnection.id}`,
    );
  });

  describe('redesigned sections', () => {
    const richOrder: OrderRecord = {
      ...sampleOrder,
      orderSnapshot: {
        orderNumber: 'A-1024',
        status: 'processing',
        items: [
          { id: 'it1', productId: 'ol_product_1', quantity: 2, price: 10, sku: 'SKU-1', name: 'Camera' },
        ],
        totals: { subtotal: 20, tax: 3.92, shipping: 5, total: 28.92, currency: 'PLN', taxTreatment: 'inclusive' },
        shippingAddress: {
          firstName: 'Jan',
          lastName: 'Kowalski',
          address1: 'ul. Testowa 1',
          city: 'Warszawa',
          postalCode: '00-001',
          country: 'PL',
        },
        pickupPoint: { id: 'POP-WAW-04412' },
        shipping: { methodId: 'm1', methodName: 'InPost Paczkomat' },
      },
    };

    it('derives the sync health cell from syncStatus', async () => {
      const api = createMockApiClient({ orders: { getById: vi.fn().mockResolvedValue(richOrder) } });
      renderDetail(api);
      expect(await screen.findByText('1 of 1 synced')).toBeInTheDocument();
    });

    it('surfaces the tax treatment as gross for tax-inclusive totals', async () => {
      const api = createMockApiClient({ orders: { getById: vi.fn().mockResolvedValue(richOrder) } });
      renderDetail(api);
      expect(await screen.findByText(/gross · source-authoritative/i)).toBeInTheDocument();
      expect(screen.getAllByText('Camera').length).toBeGreaterThan(0);
    });

    it('renders the buyer-selected pickup point and delivery method', async () => {
      const api = createMockApiClient({ orders: { getById: vi.fn().mockResolvedValue(richOrder) } });
      renderDetail(api);
      expect(await screen.findByText('POP-WAW-04412')).toBeInTheDocument();
      expect(screen.getByText('InPost Paczkomat')).toBeInTheDocument();
    });

    it('summarises item and unit counts in the header', async () => {
      const api = createMockApiClient({ orders: { getById: vi.fn().mockResolvedValue(richOrder) } });
      renderDetail(api);
      expect(await screen.findByText(/1 item · 2 units/)).toBeInTheDocument();
    });

    it('renders the activity audit caption derived from the event count', async () => {
      const api = createMockApiClient({ orders: { getById: vi.fn().mockResolvedValue(richOrder) } });
      renderDetail(api);
      // 1 ingest event + 1 sync attempt = 2 events.
      expect(await screen.findByText(/Showing 2 of 2 events/)).toBeInTheDocument();
    });
  });

  describe('destination retry', () => {
    const orderWithFailure: OrderRecord = {
      ...sampleOrder,
      syncStatus: [
        {
          destinationConnectionId: sampleConnection.id,
          status: 'failed',
          syncedAt: null,
          externalOrderId: null,
          externalOrderNumber: null,
          error: 'PrestaShop country PL not active',
        },
      ],
    };

    it('renders the Retry button only on failed sync rows', async () => {
      const orderMixed: OrderRecord = {
        ...orderWithFailure,
        syncStatus: [
          ...orderWithFailure.syncStatus,
          {
            destinationConnectionId: 'conn-other',
            status: 'synced',
            syncedAt: '2026-04-29T11:00:00.000Z',
            externalOrderId: 'PS-1',
            externalOrderNumber: '1',
            error: null,
          },
        ],
      };
      const api = createMockApiClient({
        orders: { getById: vi.fn().mockResolvedValue(orderMixed) },
      });

      renderDetail(api);

      // Only the failed row gets a Retry button (the banner-level "View failed orders"
      // is a link, not a button, so getAllByRole('button', ...) excludes it).
      const retryButtons = await screen.findAllByRole('button', { name: 'Retry' });
      expect(retryButtons).toHaveLength(1);
    });

    it('calls retryDestination with the right ids on click', async () => {
      const retryFn = vi.fn().mockResolvedValue({
        internalOrderId: 'ol_order_abc123',
        destinationConnectionId: sampleConnection.id,
        jobId: 'job-new',
        jobType: 'marketplace.order.sync',
      });
      const api = createMockApiClient({
        orders: {
          getById: vi.fn().mockResolvedValue(orderWithFailure),
          retryDestination: retryFn,
        },
      });

      renderDetail(api);

      const retryButton = await screen.findByRole('button', { name: 'Retry' });
      await userEvent.click(retryButton);

      expect(retryFn).toHaveBeenCalledWith('ol_order_abc123', sampleConnection.id);
    });

    it('disables the Retry button while the mutation is in flight', async () => {
      // Deferred retry that never resolves — keeps the mutation in `isPending` state
      // for the duration of the assertion.
      const retryFn = vi.fn().mockReturnValue(new Promise(() => {}));
      const api = createMockApiClient({
        orders: {
          getById: vi.fn().mockResolvedValue(orderWithFailure),
          retryDestination: retryFn,
        },
      });

      renderDetail(api);

      const retryButton = await screen.findByRole('button', { name: 'Retry' });
      expect(retryButton).toBeEnabled();
      await userEvent.click(retryButton);

      // After the click, the button text flips to "Retrying…" and is disabled until the
      // promise settles. Looking up by name covers the new accessible label.
      const retryingButton = await screen.findByRole('button', { name: 'Retrying…' });
      expect(retryingButton).toBeDisabled();
    });
  });
});
