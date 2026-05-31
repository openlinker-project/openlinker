/**
 * OrdersListPage tests
 *
 * Covers the triage-queue redesign (#929): status segments backed by the
 * partitioning `/orders/status-summary` count endpoint, the `health` URL
 * filter, the single reconciled health badge (`deriveOrderHealth`) replacing
 * the per-destination list, customer + contents columns parsed from the
 * snapshot, the all-clear empty state, and the inline per-row Retry. Preserves
 * the canonical async states (loading / error / empty / data).
 */
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { OrdersListPage } from './orders-list-page';
import type {
  PaginatedOrders,
  OrderRecord,
  OrderHealthSummary,
} from '../../features/orders/api/orders.types';
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

const syncedOrder: OrderRecord = {
  internalOrderId: 'ol_order_synced',
  customerId: 'ol_customer_xyz',
  sourceConnectionId: 'conn_allegro_1',
  sourceEventId: null,
  orderSnapshot: {
    orderNumber: 'ALG-882414',
    items: [{ id: 'i1', quantity: 1, price: 84.2, name: 'Filtr kubełkowy AquaPro' }],
    totals: { subtotal: 80, tax: 4.2, shipping: 0, total: 84.2, currency: 'EUR' },
    shippingAddress: {
      firstName: 'Anna',
      lastName: 'Kowalska',
      address1: 'ul. Testowa 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'PL',
    },
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

const failedOrder: OrderRecord = {
  ...syncedOrder,
  internalOrderId: 'ol_order_failed',
  orderSnapshot: { ...syncedOrder.orderSnapshot, orderNumber: 'ALG-FAIL' },
  syncStatus: [
    {
      destinationConnectionId: 'conn_ps_1',
      status: 'failed',
      syncedAt: null,
      externalOrderId: null,
      externalOrderNumber: null,
      error: 'Carrier not mapped in OMP',
    },
  ],
};

function paginated(items: OrderRecord[]): PaginatedOrders {
  return { items, total: items.length, limit: 20, offset: 0 };
}

const emptySummary: OrderHealthSummary = {
  total: 0,
  awaitingMapping: 0,
  needsAttention: 0,
  synced: 0,
  awaitingDispatch: 0,
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

  it('should show empty state with a Manage connections CTA when no orders exist and no filter is active', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([])) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    expect(await screen.findByText('No orders found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage connections' })).toHaveAttribute(
      'href',
      '/connections',
    );
  });

  it('should show the all-clear empty state when the needs-attention filter is empty', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([])) },
    });

    renderWithProviders(<OrdersListPage />, {
      apiClient: mockApi,
      route: '/orders?health=needs_attention',
    });

    expect(
      await screen.findByText('All clear — nothing needs your attention'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View all orders' })).toBeInTheDocument();
  });

  it('should render status segments with counts from the summary endpoint (#929)', async () => {
    const statusSummary = vi.fn().mockResolvedValue({
      total: 11,
      needsAttention: 1,
      awaitingMapping: 0,
      awaitingDispatch: 9,
      synced: 1,
    } satisfies OrderHealthSummary);
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])), statusSummary },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    expect(await screen.findByText('All orders')).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('Awaiting mapping')).toBeInTheDocument();
    expect(screen.getByText('Awaiting dispatch')).toBeInTheDocument();

    await vi.waitFor(() => {
      const values = Array.from(container.querySelectorAll('.metric-card__value')).map(
        (el) => el.textContent,
      );
      expect(values).toContain('11'); // total
      expect(values).toContain('9'); // awaiting dispatch
    });
  });

  it('should filter the list by health when a status segment is clicked (#929)', async () => {
    const user = userEvent.setup();
    const list = vi.fn().mockResolvedValue(paginated([syncedOrder]));
    const mockApi = createMockApiClient({
      orders: { list },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    await user.click(screen.getByRole('button', { name: /Needs attention/ }));

    await vi.waitFor(() => {
      const calledWithHealth = list.mock.calls.some(
        ([filters]) => (filters as { health?: string } | undefined)?.health === 'needs_attention',
      );
      expect(calledWithHealth).toBe(true);
    });
  });

  it('should render one reconciled health badge with a plain-language reason for a failed order (#929)', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([failedOrder])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-FAIL');
    const row = container.querySelector('.data-table__row');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('Sync failed')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('Carrier not mapped in OMP')).toBeInTheDocument();
  });

  it('should render Awaiting dispatch for an order with an empty syncStatus (#929)', async () => {
    const dispatchOrder: OrderRecord = {
      ...syncedOrder,
      internalOrderId: 'ol_order_dispatch',
      orderSnapshot: { ...syncedOrder.orderSnapshot, orderNumber: 'ALG-DISPATCH' },
      syncStatus: [],
    };
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([dispatchOrder])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-DISPATCH');
    const row = container.querySelector('.data-table__row') as HTMLElement;
    expect(within(row).getByText('Awaiting dispatch')).toBeInTheDocument();
  });

  it('should render customer and item-count columns parsed from the snapshot (#929)', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    const row = container.querySelector('.data-table__row') as HTMLElement;
    expect(within(row).getByText('Anna Kowalska')).toBeInTheDocument();
    expect(within(row).getByText('Warszawa')).toBeInTheDocument();
    expect(within(row).getByText('1 item')).toBeInTheDocument();
  });

  it('should render a channel-pill resolved from the connection platformType', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    const pill = container.querySelector('.channel-pill[data-channel="allegro"]');
    expect(pill?.textContent).toBe('Allegro');
  });

  it('should fall back to the internalOrderId when the snapshot has no orderNumber', async () => {
    const orderWithoutNumber: OrderRecord = {
      ...syncedOrder,
      internalOrderId: 'ol_order_no_number',
      orderSnapshot: {},
    };
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([orderWithoutNumber])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    expect(await screen.findByText('ol_order_no_number')).toBeInTheDocument();
  });

  it('should call retryDestination with the failed destination when the row Retry is clicked (#929)', async () => {
    const user = userEvent.setup();
    const retryDestination = vi.fn().mockResolvedValue({
      internalOrderId: 'ol_order_failed',
      destinationConnectionId: 'conn_ps_1',
      jobId: 'job_1',
      jobType: 'marketplace.order.sync',
    });
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([failedOrder])), retryDestination },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-FAIL');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await vi.waitFor(() => {
      expect(retryDestination).toHaveBeenCalledWith('ol_order_failed', 'conn_ps_1');
    });
  });

  it('should render a temporal "Synced HH:MM" eyebrow derived from the freshest updatedAt', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    expect(await screen.findByText(/^Synced \d{1,2}:\d{2}/)).toBeInTheDocument();
  });

  it('should refetch the list and summary when the R shortcut fires', async () => {
    const user = userEvent.setup();
    const list = vi.fn().mockResolvedValue(paginated([syncedOrder]));
    const statusSummary = vi.fn().mockResolvedValue(emptySummary);
    const mockApi = createMockApiClient({ orders: { list, statusSummary } });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    const listBaseline = list.mock.calls.length;
    const summaryBaseline = statusSummary.mock.calls.length;

    await user.keyboard('r');

    await vi.waitFor(() => {
      expect(list.mock.calls.length).toBeGreaterThan(listBaseline);
      expect(statusSummary.mock.calls.length).toBeGreaterThan(summaryBaseline);
    });
  });
});
