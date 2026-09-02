import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../test/test-utils';
import { OrderDetailPage } from './order-detail-page';
import type { OrderRecord } from '../../features/orders/api/orders.types';
import type { Connection } from '../../features/connections';

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
        placedAt: '2026-05-31T16:00:00.000Z',
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
      // Appears twice: the "Method" field, and the "Carrier" field falling back
      // to the same method name (#1617, no shipment exists for this order).
      expect(screen.getAllByText('InPost Paczkomat').length).toBeGreaterThanOrEqual(1);
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

    it('leads with the buyer-placed timestamp and demotes the OL clocks (#926)', async () => {
      const api = createMockApiClient({ orders: { getById: vi.fn().mockResolvedValue(richOrder) } });
      renderDetail(api);
      // Header "Placed …" + Summary "Placed" row.
      expect((await screen.findAllByText(/^Placed$|Placed/)).length).toBeGreaterThan(0);
      // OL ingestion clock is demoted, not removed.
      expect(screen.getByText('Received (OL)')).toBeInTheDocument();
    });

    it('falls back to the OL received time in the header when no placedAt is present (#926)', async () => {
      const noPlaced: OrderRecord = {
        ...richOrder,
        orderSnapshot: { ...richOrder.orderSnapshot, placedAt: undefined },
      };
      const api = createMockApiClient({ orders: { getById: vi.fn().mockResolvedValue(noPlaced) } });
      renderDetail(api);
      // Header + summary both show "Received" (the OL ingestion clock); no "Placed" anywhere.
      expect((await screen.findAllByText(/Received/)).length).toBeGreaterThan(0);
      expect(screen.queryByText(/Placed/)).toBeNull();
    });
  });

  describe('carrier field (#1617)', () => {
    const orderWithMethod: OrderRecord = {
      ...sampleOrder,
      orderSnapshot: {
        shipping: { methodId: 'm1', methodName: 'InPost Paczkomat' },
      },
    };

    it('prefers the shipment record carrier over the snapshot method name when a shipment exists', async () => {
      const api = createMockApiClient({
        orders: { getById: vi.fn().mockResolvedValue(orderWithMethod) },
        shipments: {
          list: vi.fn().mockResolvedValue({
            items: [
              {
                id: 'ol_shipment_1',
                orderId: orderWithMethod.internalOrderId,
                customerId: null,
                connectionId: sampleConnection.id,
                shippingMethod: 'paczkomat',
                status: 'dispatched',
                providerShipmentId: 'prov-1',
                paczkomatId: 'POZ08A',
                sourceDeliveryMethodId: null,
                deliveryIntent: null,
                trackingNumber: 'TRACK-1',
                carrier: 'inpost',
                labelPdfRef: null,
                dispatchedAt: '2026-05-01T10:00:00.000Z',
                deliveredAt: null,
                cancelledAt: null,
                failedAt: null,
                errorMessage: null,
                providerCode: null,
                createdAt: '2026-05-01T09:00:00.000Z',
                updatedAt: '2026-05-01T10:00:00.000Z',
              },
            ],
            total: 1,
            limit: 20,
            offset: 0,
          }),
        },
      });

      renderDetail(api);

      expect(await screen.findByText('Carrier')).toBeInTheDocument();
      expect(screen.getByText('InPost')).toBeInTheDocument();
    });

    it('falls back to the snapshot delivery method name when no shipment exists', async () => {
      const api = createMockApiClient({
        orders: { getById: vi.fn().mockResolvedValue(orderWithMethod) },
      });

      renderDetail(api);

      expect(await screen.findByText('Carrier')).toBeInTheDocument();
      // Appears twice: the "Method" field and the "Carrier" field's fallback
      // to the same value (no shipment record exists for this order).
      expect(screen.getAllByText('InPost Paczkomat').length).toBe(2);
    });

    it('renders "-" for carrier when neither a shipment nor a delivery method is present', async () => {
      const api = createMockApiClient({
        orders: { getById: vi.fn().mockResolvedValue(sampleOrder) },
      });

      renderDetail(api);

      expect(await screen.findByText('Carrier')).toBeInTheDocument();
      // Both the always-present Method row (#1776) and the Carrier row fall back
      // to "-" when the order has neither a source delivery method nor a shipment.
      expect(screen.getAllByText('-')).toHaveLength(2);
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

  describe('shipment deep-link (#1826)', () => {
    const shippingConnection: Connection = {
      ...sampleConnection,
      id: 'conn-shipping',
      supportedCapabilities: ['ShippingProviderManager'],
      enabledCapabilities: ['ShippingProviderManager'],
    };

    // A live OL-managed-carrier route + a paczkomat-shaped snapshot (mirrors
    // order-shipment-panel.test.tsx's makeOrder()) so GenerateLabelForm
    // resolves shippingMethod === 'paczkomat' and renders the paczkomatId
    // field rather than gating on "no routing resolved" / courier-only fields.
    const orderWithPaczkomatRoute: OrderRecord = {
      ...sampleOrder,
      orderSnapshot: {
        id: '1234',
        orderNumber: 'A-1234',
        customerEmail: 'buyer@example.com',
        shippingAddress: {
          firstName: 'Anna',
          lastName: 'Kowalska',
          address1: 'Krakowska 12',
          city: 'Poznań',
          postalCode: '60-001',
          country: 'PL',
          phone: '+48500600700',
        },
        shipping: { methodId: 'allegro-courier', methodName: 'Kurier Allegro' },
        pickupPoint: { id: 'POZ08A', name: 'Paczkomat POZ08A' },
      },
      deliveryResolution: {
        source: 'rule',
        processorKind: 'ol_managed_carrier',
        processorConnectionId: shippingConnection.id,
        processorAvailable: true,
      },
    };

    /** Echoes the live URL so the param-stripping assertion can read it. */
    function LocationProbe(): ReactElement {
      const location = useLocation();
      return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
    }

    function renderWithRoute(apiClient: ReturnType<typeof createMockApiClient>, route: string): void {
      renderWithProviders(
        <Routes>
          <Route
            path="/orders/:internalOrderId"
            element={
              <>
                <OrderDetailPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>,
        // The deep-link auto-open is gated on `shipments:write` (#1905), so an
        // anonymous render would never open the form.
        { apiClient, route, sessionAdapter: createAuthenticatedSessionAdapter() },
      );
    }

    it('reads ?retryShipmentId= and auto-opens the form with the shipment pre-filled', async () => {
      const api = createMockApiClient({
        orders: { getById: vi.fn().mockResolvedValue(orderWithPaczkomatRoute) },
        connections: { list: vi.fn().mockResolvedValue([shippingConnection]) },
        shipments: {
          list: vi.fn().mockResolvedValue({
            items: [
              {
                id: 'ol_shipment_failed',
                orderId: orderWithPaczkomatRoute.internalOrderId,
                customerId: null,
                connectionId: shippingConnection.id,
                shippingMethod: 'paczkomat',
                status: 'failed',
                providerShipmentId: null,
                paczkomatId: 'POZ08A',
                sourceDeliveryMethodId: null,
                deliveryIntent: null,
                trackingNumber: null,
                carrier: null,
                labelPdfRef: null,
                dispatchedAt: null,
                deliveredAt: null,
                cancelledAt: null,
                failedAt: '2026-05-01T10:00:00.000Z',
                errorMessage: 'sender postcode invalid',
                providerCode: null,
                createdAt: '2026-05-01T09:00:00.000Z',
                updatedAt: '2026-05-01T10:00:00.000Z',
              },
            ],
            total: 1,
            limit: 20,
            offset: 0,
          }),
        },
      });

      renderWithRoute(api, '/orders/ol_order_abc123?retryShipmentId=ol_shipment_failed');

      expect(await screen.findByDisplayValue('POZ08A')).toBeInTheDocument();
    });

    it('leaves the form collapsed when no retryShipmentId param is present', async () => {
      const api = createMockApiClient({
        orders: { getById: vi.fn().mockResolvedValue(orderWithPaczkomatRoute) },
        connections: { list: vi.fn().mockResolvedValue([shippingConnection]) },
        shipments: {
          list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
        },
      });

      renderWithRoute(api, '/orders/ol_order_abc123');

      await screen.findByText('No shipment yet');
      expect(screen.queryByText('Recipient')).toBeNull();
    });

    it('should strip retryShipmentId from the URL after consuming it while preserving from (#1905)', async () => {
      // A one-shot navigation token, not durable URL state: leaving it on the
      // address bar means a bookmark / refresh / back-navigation re-lands on a
      // live, submittable mutation surface.
      const api = createMockApiClient({
        orders: { getById: vi.fn().mockResolvedValue(orderWithPaczkomatRoute) },
        connections: { list: vi.fn().mockResolvedValue([shippingConnection]) },
        shipments: {
          list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
        },
      });

      renderWithRoute(
        api,
        '/orders/ol_order_abc123?retryShipmentId=ol_shipment_failed&from=shipments',
      );

      await waitFor(() => {
        expect(screen.getByTestId('location').textContent).toBe(
          '/orders/ol_order_abc123?from=shipments',
        );
      });
    });

    it('should point the back link at /shipments when arriving with from=shipments (#1905)', async () => {
      const api = createMockApiClient({
        orders: { getById: vi.fn().mockResolvedValue(orderWithPaczkomatRoute) },
        connections: { list: vi.fn().mockResolvedValue([shippingConnection]) },
        shipments: {
          list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
        },
      });

      renderWithRoute(api, '/orders/ol_order_abc123?from=shipments');

      const back = await screen.findByRole('link', { name: 'Shipments' });
      expect(back).toHaveAttribute('href', '/shipments');
    });

    it('should keep the default /orders back link when arriving without from', async () => {
      const api = createMockApiClient({
        orders: { getById: vi.fn().mockResolvedValue(orderWithPaczkomatRoute) },
        connections: { list: vi.fn().mockResolvedValue([shippingConnection]) },
        shipments: {
          list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
        },
      });

      renderWithRoute(api, '/orders/ol_order_abc123');

      const back = await screen.findByRole('link', { name: 'Orders' });
      expect(back).toHaveAttribute('href', '/orders');
    });
  });
});

describe('OrderDetailPage — lifecycle phase (#2310)', () => {
  afterEach(cleanup);

  it('shows the phase badge beside the health badge with its waiting-on line', async () => {
    const api = createMockApiClient({
      orders: {
        getById: vi.fn().mockResolvedValue({ ...sampleOrder, lifecyclePhase: 'blocked' }),
      },
    });

    renderDetail(api);

    expect(await screen.findByText('Blocked')).toBeInTheDocument();
    // The detail page has room for the sentence the row does not.
    expect(
      screen.getByText('Waiting on OpenLinker — the order cannot be matched yet.'),
    ).toBeInTheDocument();
  });

  it('renders no phase surface at all for a payload predating the field', async () => {
    const api = createMockApiClient({
      orders: { getById: vi.fn().mockResolvedValue(sampleOrder) },
    });

    renderDetail(api);

    await screen.findByText('ol_order_abc123');
    expect(screen.queryByText(/waiting to be dispatched/i)).toBeNull();
  });
});

describe('OrderDetailPage — returns activity on the timeline (#2383)', () => {
  afterEach(cleanup);

  const returnEvent = {
    id: 'ev1',
    source: 'custody_act',
    kind: 'receive',
    occurredAt: '2026-04-20T09:30:00.000Z',
    returnId: 'ol_return_1',
    externalReturnId: 'RMA-9',
    returnOrigin: 'source_ingested',
    sourceConnectionName: 'Allegro PL',
    actorUserId: null,
    quantity: 2,
    restockState: null,
    disposition: null,
    refundExecutedBy: null,
    amount: null,
    currency: null,
  };

  // A component test renders the component itself and cannot prove anything
  // MOUNTS it. This asserts the events reach the PAGE.
  it('renders return activity in the order timeline', async () => {
    const api = createMockApiClient({
      orders: { getById: vi.fn().mockResolvedValue(sampleOrder) },
      connections: { getById: vi.fn().mockResolvedValue(sampleConnection) },
      returns: { listReturnEventsForOrder: vi.fn().mockResolvedValue([returnEvent]) },
    });

    renderDetail(api);

    expect(await screen.findByText('Return received')).toBeInTheDocument();
    expect(api.returns.listReturnEventsForOrder).toHaveBeenCalledWith('ol_order_abc123');
  });

  it('renders the order timeline unchanged when the order has no returns', async () => {
    const api = createMockApiClient({
      orders: { getById: vi.fn().mockResolvedValue(sampleOrder) },
      connections: { getById: vi.fn().mockResolvedValue(sampleConnection) },
      returns: { listReturnEventsForOrder: vi.fn().mockResolvedValue([]) },
    });

    renderDetail(api);

    expect(await screen.findByText('Activity')).toBeInTheDocument();
    expect(screen.queryByText('Return received')).not.toBeInTheDocument();
  });

  it('still renders the order timeline when the returns read FAILS', async () => {
    // Non-fatal by design: a returns read that could not answer must not take
    // the order's own history down with it.
    const api = createMockApiClient({
      orders: { getById: vi.fn().mockResolvedValue(sampleOrder) },
      connections: { getById: vi.fn().mockResolvedValue(sampleConnection) },
      returns: {
        listReturnEventsForOrder: vi.fn().mockRejectedValue(new Error('unreadable')),
      },
    });

    renderDetail(api);

    expect(await screen.findByText('Activity')).toBeInTheDocument();
  });
});
