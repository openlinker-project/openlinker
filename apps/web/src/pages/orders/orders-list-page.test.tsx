/**
 * OrdersListPage tests
 *
 * Covers the cockpit redesign (#778): KPI strip wiring, filter-chip
 * behaviour, channel-pill resolution via `useConnectionsQuery`,
 * EntityLabel rendering on the Order column, pulse-on-syncing badge
 * state. Preserves the four canonical async states
 * (loading / error / empty / data) from the original page.
 */
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { OrdersListPage } from './orders-list-page';
import type { PaginatedOrders, OrderRecord } from '../../features/orders/api/orders.types';
import type { Connection } from '../../features/connections';

const sampleConnection: Connection = {
  id: 'conn_allegro_1',
  name: 'Allegro Store',
  platformType: 'allegro',
  status: 'active',
  config: {},
  credentialsBacked: false,
  enabledCapabilities: [],
  supportedCapabilities: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const sampleOrder: OrderRecord = {
  internalOrderId: 'ol_order_abc123',
  customerId: 'ol_customer_xyz',
  sourceConnectionId: 'conn_allegro_1',
  sourceEventId: null,
  orderSnapshot: {
    orderNumber: 'ALG-882414',
    totals: { subtotal: 80, tax: 4.2, shipping: 0, total: 84.2, currency: 'EUR' },
  },
  syncStatus: [
    {
      destinationConnectionId: 'conn_ps_1',
      status: 'synced',
      syncedAt: '2026-01-15T10:00:00.000Z',
      externalOrderId: '42',
      externalOrderNumber: null,
      error: null,
    },
  ],
  syncAttempts: [],
  recordStatus: 'ready',
  createdAt: '2026-01-15T10:00:00.000Z',
  updatedAt: '2026-01-15T10:00:00.000Z',
};

const sampleOrders: PaginatedOrders = {
  items: [sampleOrder],
  total: 1,
  limit: 20,
  offset: 0,
};

describe('OrdersListPage', () => {
  afterEach(cleanup);

  it('should show loading state initially', () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockReturnValue(new Promise(() => {})) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should show error state when fetch fails', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockRejectedValue(new Error('Network error')) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    expect(await screen.findByText('Unable to load orders')).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('should show empty state with a Manage connections CTA when no orders exist and no filters are active', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    expect(await screen.findByText('No orders found')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: 'Manage connections' });
    expect(cta).toHaveAttribute('href', '/connections');
  });

  it('should show a Clear filters button that clears syncStatus from the URL when a filter is active', async () => {
    const user = userEvent.setup();
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }) },
    });

    renderWithProviders(<OrdersListPage />, {
      apiClient: mockApi,
      route: '/orders?syncStatus=failed',
    });

    expect(await screen.findByText('No orders match the current filters.')).toBeInTheDocument();
    // Two "Clear filters" affordances now exist: the chip-row button
    // and the empty-state CTA. Either path clears the URL filter; pick
    // the empty-state CTA (last) so the test mirrors the operator flow
    // when the filter strips the result set.
    const clearButtons = screen.getAllByRole('button', { name: 'Clear filters' });
    await user.click(clearButtons[clearButtons.length - 1]);

    expect(await screen.findByRole('link', { name: 'Manage connections' })).toBeInTheDocument();
  });

  it('should render the KPI strip with four status counts wired to the orders query (#778)', async () => {
    // Each MetricCard reads `.total` from its own filtered useOrdersQuery
    // call (limit:1). Mocking `orders.list` so the count varies by filter
    // arg exercises the four wires independently.
    const list = vi.fn().mockImplementation(async (filters?: { syncStatus?: string }) => {
      if (filters?.syncStatus === 'synced') return { items: [], total: 7, limit: 1, offset: 0 };
      if (filters?.syncStatus === 'pending') return { items: [], total: 3, limit: 1, offset: 0 };
      if (filters?.syncStatus === 'failed') return { items: [], total: 1, limit: 1, offset: 0 };
      return sampleOrders;
    });
    const mockApi = createMockApiClient({ orders: { list } });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    // Labels are rendered by MetricCard.
    expect(await screen.findByText('All orders')).toBeInTheDocument();
    expect(screen.getByText('Synced')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();

    // Values flow through once each query resolves. Scope to the
    // MetricCard value slot — bare digit text would collide with the
    // paginator's "Showing 1–1 of 1" line.
    await screen.findByText('All orders');
    const values = Array.from(container.querySelectorAll('.metric-card__value')).map(
      (el) => el.textContent,
    );
    expect(values).toContain('7'); // Synced
    expect(values).toContain('3'); // Pending
    expect(values).toContain('1'); // Failed
  });

  it('should render a channel-pill resolved from the connection platformType (#778)', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(sampleOrders) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    // Wait for the data row to mount.
    await screen.findByText('ALG-882414');

    const pill = container.querySelector('.channel-pill[data-channel="allegro"]');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toBe('Allegro');
  });

  it('should render the EntityLabel name from the parsed orderNumber, falling back to the internalOrderId when absent (#778)', async () => {
    const orderWithoutNumber: OrderRecord = {
      ...sampleOrder,
      internalOrderId: 'ol_order_no_number',
      orderSnapshot: {}, // No orderNumber.
    };
    const mockApi = createMockApiClient({
      orders: {
        list: vi.fn().mockResolvedValue({
          items: [sampleOrder, orderWithoutNumber],
          total: 2,
          limit: 20,
          offset: 0,
        }),
      },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    // Parsed orderNumber wins as the human-facing label.
    expect(await screen.findByText('ALG-882414')).toBeInTheDocument();
    // Fallback: when no orderNumber, the EntityLabel renders the
    // internalOrderId.
    expect(await screen.findByText('ol_order_no_number')).toBeInTheDocument();
  });

  it('should add the pulse class to the StatusBadge when a destination is syncing (#778)', async () => {
    const orderSyncing: OrderRecord = {
      ...sampleOrder,
      syncStatus: [
        {
          destinationConnectionId: 'conn_ps_1',
          status: 'syncing',
          syncedAt: null,
          externalOrderId: null,
          externalOrderNumber: null,
          error: null,
        },
      ],
    };
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue({ items: [orderSyncing], total: 1, limit: 20, offset: 0 }) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('syncing');

    // StatusBadge applies the pulse-* class to its element when pulse=true.
    // The class is the contract the cockpit ties its animation to.
    const pulsed = container.querySelector('[class*="pulse"]');
    expect(pulsed).not.toBeNull();
  });
});
