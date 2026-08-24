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
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient, createAuthenticatedSessionAdapter } from '../../test/test-utils';
import { OrdersListPage } from './orders-list-page';
import type {
  PaginatedOrders,
  OrderRecord,
  OrderHealthSummary,
} from '../../features/orders/api/orders.types';
import type { Connection } from '../../features/connections';

const captureDemoEvent = vi.fn();
vi.mock('../../features/demo', () => ({
  captureDemoEvent: (...args: unknown[]): unknown => captureDemoEvent(...args),
}));

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
  sourceDeleted: 0,
  awaitingMapping: 0,
  needsAttention: 0,
  synced: 0,
  awaitingDispatch: 0,
};

/** Forces the mobile (cardView) breakpoint for the DataTable (#1620). */
function mockMobileViewport(): { restore: () => void } {
  const spy = vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: query.includes('max-width'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
  return { restore: () => spy.mockRestore() };
}

describe('OrdersListPage', () => {
  beforeEach(() => {
    captureDemoEvent.mockClear();
  });
  afterEach(cleanup);

  it('captures demo_orders_viewed once when the list loads (#1788)', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_orders_viewed', {});
    expect(captureDemoEvent).toHaveBeenCalledTimes(1);
  });

  it('captures demo_order_opened when a row link is clicked (#1788)', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    const link = await screen.findByRole('link', { name: 'ALG-882414' });
    fireEvent.click(link);

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_order_opened', {});
  });

  it('captures demo_orders_filtered with filter=sla_breaching when the overdue chip is clicked (#1788)', async () => {
    const user = userEvent.setup();
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    await user.click(screen.getByRole('button', { name: 'Ship-by ≤ 24h / overdue' }));

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_orders_filtered', {
      filter: 'sla_breaching',
      value: 'true',
    });
  });

  it('captures demo_orders_filtered with filter=health when a health segment is clicked (#1788)', async () => {
    const user = userEvent.setup();
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('All orders');
    await user.click(screen.getByText('All orders'));

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_orders_filtered', {
      filter: 'health',
      value: 'all',
    });
  });

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

  describe('filtered empty state (#2148)', () => {
    // Every narrowing filter must say "nothing matched", never "nothing has ever
    // synced" — the latter is a statement about the whole dataset, and an
    // operator with thousands of orders reads it as an ingestion outage.
    const NARROWING_ROUTES: ReadonlyArray<readonly [string, string]> = [
      ['ship-by SLA chip', '/orders?due=breaching'],
      ['SLA state select', '/orders?slaState=overdue'],
      ['fulfillment select', '/orders?fulfillmentState=not-shipped'],
      ['source select', '/orders?sourceConnectionId=conn_1'],
      ['created-from date', '/orders?createdFrom=2026-01-01'],
      ['created-to date', '/orders?createdTo=2026-01-31'],
    ];

    it.each(NARROWING_ROUTES)(
      'should not claim nothing has synced when the %s yields no rows',
      async (_label, route) => {
        const mockApi = createMockApiClient({
          orders: { list: vi.fn().mockResolvedValue(paginated([])) },
        });

        renderWithProviders(<OrdersListPage />, { apiClient: mockApi, route });

        expect(await screen.findByText('No orders in this view')).toBeInTheDocument();
        expect(screen.queryByText(/No order records have been synced yet/i)).toBeNull();
        // The recovery affordance must clear the filter, not send the operator
        // to /connections to debug an ingestion problem that does not exist.
        expect(screen.getByRole('button', { name: 'View all orders' })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Manage connections' })).toBeNull();
      },
    );

    it('should clear every filter in one write from the recovery button', async () => {
      const list = vi.fn().mockResolvedValue(paginated([]));
      const mockApi = createMockApiClient({ orders: { list } });

      renderWithProviders(<OrdersListPage />, {
        apiClient: mockApi,
        // Several axes at once: `setSearchParams` builds from the current
        // render's params, so clearing them one call at a time would leave all
        // but the last applied.
        route:
          '/orders?due=breaching&slaState=overdue&fulfillmentState=not-shipped&sourceConnectionId=conn_1&createdFrom=2026-01-01&createdTo=2026-01-31',
      });

      const recover = await screen.findByRole('button', { name: 'View all orders' });
      const before = list.mock.calls.length;
      await userEvent.setup().click(recover);

      await vi.waitFor(() => {
        expect(list.mock.calls.length).toBeGreaterThan(before);
      });

      const [filters, pagination] = list.mock.calls[list.mock.calls.length - 1];
      expect(filters.dueBefore).toBeUndefined();
      expect(filters.slaState).toBeUndefined();
      expect(filters.fulfillmentState).toBeUndefined();
      expect(filters.sourceConnectionId).toBeUndefined();
      expect(filters.createdFrom).toBeUndefined();
      expect(filters.createdTo).toBeUndefined();
      expect(pagination).toMatchObject({ offset: 0 });
    });

    it('should show the error state, never the filtered empty state, when a narrowed query rejects', async () => {
      // The `isLoading -> error -> empty` ternary order means a rejected query
      // never reaches any empty-state arm today — but that ordering is a plausible
      // future edit, so pin it rather than relying on it holding by accident.
      const mockApi = createMockApiClient({
        orders: { list: vi.fn().mockRejectedValue(new Error('Network error')) },
      });

      renderWithProviders(<OrdersListPage />, {
        apiClient: mockApi,
        route: '/orders?slaState=overdue',
      });

      expect(await screen.findByText('Unable to load orders')).toBeInTheDocument();
      expect(screen.queryByText('No orders in this view')).toBeNull();
    });

    it('should keep sort and direction — they narrow nothing', async () => {
      const list = vi.fn().mockResolvedValue(paginated([]));
      const mockApi = createMockApiClient({ orders: { list } });

      renderWithProviders(<OrdersListPage />, {
        apiClient: mockApi,
        route: '/orders?due=breaching&sort=createdAt&dir=asc',
      });

      const recover = await screen.findByRole('button', { name: 'View all orders' });
      const before = list.mock.calls.length;
      await userEvent.setup().click(recover);

      await vi.waitFor(() => {
        expect(list.mock.calls.length).toBeGreaterThan(before);
      });

      // "View all orders" restores membership, not presentation — resetting the
      // operator's chosen column sort would be a second, unasked-for change.
      const [filters] = list.mock.calls[list.mock.calls.length - 1];
      expect(filters).toMatchObject({ sort: 'createdAt', dir: 'asc' });
    });

    it('should still say nothing has synced when no filter is applied', async () => {
      const mockApi = createMockApiClient({
        orders: { list: vi.fn().mockResolvedValue(paginated([])) },
      });

      renderWithProviders(<OrdersListPage />, { apiClient: mockApi, route: '/orders' });

      expect(await screen.findByText('No orders found')).toBeInTheDocument();
      expect(screen.getByText(/No order records have been synced yet/i)).toBeInTheDocument();
    });
  });

  it('should render status segments with counts from the summary endpoint (#929)', async () => {
    const statusSummary = vi.fn().mockResolvedValue({
      total: 11,
      sourceDeleted: 0,
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

  it('should render customer columns parsed from the snapshot (#929)', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    const row = container.querySelector('.data-table__row') as HTMLElement;
    expect(within(row).getByText('Anna Kowalska')).toBeInTheDocument();
    expect(within(row).getByText('Warszawa')).toBeInTheDocument();
  });

  it('should expand the row detail with the item count when the row is clicked (#1620)', async () => {
    const user = userEvent.setup();
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    expect(container.querySelector('.data-table__detail-row')).toBeNull();

    const row = container.querySelector('.data-table__row') as HTMLElement;
    await user.click(row);

    const detailRow = container.querySelector('.data-table__detail-row') as HTMLElement;
    expect(detailRow).not.toBeNull();
    // The accordion now leads with an itemised list headed "Items (N)" (#1713).
    expect(within(detailRow).getByText('Items (1)')).toBeInTheDocument();
    expect(row).toHaveAttribute('class', expect.stringContaining('data-table__row--expanded'));

    await user.click(row);
    expect(container.querySelector('.data-table__detail-row')).toBeNull();
  });

  it('should not expand the row when the select checkbox is clicked (#1620)', async () => {
    const user = userEvent.setup();
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    const checkbox = screen.getByRole('checkbox', { name: 'Select ol_order_synced' });
    await user.click(checkbox);

    expect(container.querySelector('.data-table__detail-row')).toBeNull();
    expect(checkbox).toBeChecked();
  });

  it('should expose a working select checkbox and full field detail in the mobile card view (#1620)', async () => {
    const viewport = mockMobileViewport();
    try {
      const user = userEvent.setup();
      const mockApi = createMockApiClient({
        orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])) },
        connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
      });

      const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

      await screen.findAllByText('ALG-882414');
      expect(container.querySelector('table')).toBeNull();

      const card = container.querySelector('.data-table__card') as HTMLElement;
      expect(card).not.toBeNull();
      // The full field set is collapsed behind a "View full details" disclosure
      // now (#1713); the summary shows up front. Expand it, then assert a field.
      const disclosure = within(card).getByRole('button', { name: /view full details/i });
      await user.click(disclosure);
      expect(within(card).getByText('Items (1)')).toBeInTheDocument();

      const checkbox = within(card).getByRole('checkbox', { name: 'Select ol_order_synced' });
      await user.click(checkbox);
      expect(checkbox).toBeChecked();
    } finally {
      viewport.restore();
    }
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

  it.each([
    ['erli', 'Erli'],
    ['woocommerce', 'WooCommerce'],
  ])(
    'should resolve the %s channel-pill from the plugin registry, not a local map',
    async (platformType, expectedLabel) => {
      // The deleted `CHANNEL_LABELS` map (#2088) covered only allegro /
      // prestashop / amazon / shopify, so these two rendered raw and lowercase
      // here while rendering correctly two pages over. The test above passes on
      // either implementation because `allegro` was in that map — these two are
      // what actually pin the registry as the single source of the label.
      const mockApi = createMockApiClient({
        orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])) },
        connections: {
          list: vi.fn().mockResolvedValue([{ ...sampleConnection, platformType }]),
        },
      });

      const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

      await screen.findByText('ALG-882414');
      const pill = container.querySelector(`.channel-pill[data-channel="${platformType}"]`);
      expect(pill?.textContent).toBe(expectedLabel);
    },
  );

  it('should fall back to a SHORTENED internalOrderId when the snapshot has no orderNumber (#2091)', async () => {
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

    // Pre-#2091 this printed the id verbatim. `shortenId` keeps the `ol_order_`
    // prefix (which tells an operator WHAT the id names) and elides the middle
    // of the random part, so it reads as a reference rather than as noise.
    expect(await screen.findByText('ol_order_no_n…er')).toBeInTheDocument();
    expect(screen.queryByText('ol_order_no_number')).not.toBeInTheDocument();
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

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi, sessionAdapter: createAuthenticatedSessionAdapter() });

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

  it('should default the list query to the dispatchBy (ship-by) sort (#927)', async () => {
    const list = vi.fn().mockResolvedValue(paginated([syncedOrder]));
    const mockApi = createMockApiClient({ orders: { list } });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'dispatchBy' }),
      expect.anything(),
    );
  });

  it('should render a Ship-by countdown for an order with a deadline, and "—" without (#927)', async () => {
    const withDeadline: OrderRecord = {
      ...syncedOrder,
      internalOrderId: 'ol_order_sla',
      orderSnapshot: { ...syncedOrder.orderSnapshot, orderNumber: 'ALG-SLA' },
      dispatchByAt: '2030-01-01T00:00:00.000Z', // far future → deterministic "Nd left"
    };
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([withDeadline])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-SLA');
    const row = container.querySelector('.data-table__row') as HTMLElement;
    expect(within(row).getByText(/left$/)).toBeInTheDocument();
  });

  it('should set the dueBefore filter when the breaching/overdue chip is clicked (#927)', async () => {
    const user = userEvent.setup();
    const list = vi.fn().mockResolvedValue(paginated([syncedOrder]));
    const mockApi = createMockApiClient({ orders: { list } });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    // Exact name targets the chip, not the sortable "Ship-by" column header (#944).
    await user.click(screen.getByRole('button', { name: 'Ship-by ≤ 24h / overdue' }));

    await vi.waitFor(() => {
      const calledWithDue = list.mock.calls.some(
        ([filters]) => typeof (filters as { dueBefore?: string } | undefined)?.dueBefore === 'string',
      );
      expect(calledWithDue).toBe(true);
    });
  });

  it('should filter the list by source connection when the source select changes (#939)', async () => {
    const user = userEvent.setup();
    const list = vi.fn().mockResolvedValue(paginated([syncedOrder]));
    const mockApi = createMockApiClient({
      orders: { list },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    await user.selectOptions(screen.getByLabelText('Filter by source'), 'conn_allegro_1');

    await vi.waitFor(() => {
      const called = list.mock.calls.some(
        ([filters]) =>
          (filters as { sourceConnectionId?: string } | undefined)?.sourceConnectionId ===
          'conn_allegro_1',
      );
      expect(called).toBe(true);
    });
  });

  it('should server-sort by a column (with its default direction) when its header is clicked (#944)', async () => {
    const user = userEvent.setup();
    const list = vi.fn().mockResolvedValue(paginated([syncedOrder]));
    const mockApi = createMockApiClient({
      orders: { list },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    // Total's first-click default direction is descending (biggest first).
    // The sort button's accessible name now carries its sorted state (#1713).
    await user.click(screen.getByRole('button', { name: /^Total,/ }));

    await vi.waitFor(() => {
      const called = list.mock.calls.some(([filters]) => {
        const f = filters as { sort?: string; dir?: string } | undefined;
        return f?.sort === 'total' && f?.dir === 'desc';
      });
      expect(called).toBe(true);
    });
  });

  it('should server-sort by payment and drop the offset when the Payment header is clicked (#1713)', async () => {
    const user = userEvent.setup();
    const list = vi.fn().mockResolvedValue(paginated([syncedOrder]));
    const mockApi = createMockApiClient({
      orders: { list },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    // Start on page 2 so the re-sort's offset-drop is observable.
    renderWithProviders(<OrdersListPage />, { apiClient: mockApi, route: '/orders?offset=20' });

    await screen.findByText('ALG-882414');
    await user.click(screen.getByRole('button', { name: /^Payment/ }));

    await vi.waitFor(() => {
      const called = list.mock.calls.some(([filters, pagination]) => {
        const f = filters as { sort?: string; dir?: string } | undefined;
        const p = pagination as { offset?: number } | undefined;
        return f?.sort === 'payment' && f?.dir === 'asc' && p?.offset === 0;
      });
      expect(called).toBe(true);
    });
  });

  it('should flip direction when the already-active sort header is re-clicked (#944)', async () => {
    const user = userEvent.setup();
    const list = vi.fn().mockResolvedValue(paginated([syncedOrder]));
    const mockApi = createMockApiClient({
      orders: { list },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    // Start on the default Ship-by ascending sort; re-clicking flips to desc.
    renderWithProviders(<OrdersListPage />, {
      apiClient: mockApi,
      route: '/orders?sort=dispatchBy&dir=asc',
    });

    await screen.findByText('ALG-882414');
    // `/^Ship-by,/` targets the sort button (aria-label "Ship-by, sorted …"),
    // not the "Ship-by ≤ 24h / overdue" chip (#1713).
    await user.click(screen.getByRole('button', { name: /^Ship-by,/ }));

    await vi.waitFor(() => {
      const called = list.mock.calls.some(([filters]) => {
        const f = filters as { sort?: string; dir?: string } | undefined;
        return f?.sort === 'dispatchBy' && f?.dir === 'desc';
      });
      expect(called).toBe(true);
    });
  });

  it('should no longer render the standalone sort dropdown — headers own sort now (#944)', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    expect(screen.queryByLabelText('Sort orders')).not.toBeInTheDocument();
  });

  it('should widen the created-from date to a start-of-day ISO instant (#939)', async () => {
    const list = vi.fn().mockResolvedValue(paginated([syncedOrder]));
    const mockApi = createMockApiClient({ orders: { list } });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    fireEvent.change(screen.getByLabelText('Created from'), { target: { value: '2026-05-01' } });

    await vi.waitFor(() => {
      const called = list.mock.calls.some(
        ([filters]) =>
          (filters as { createdFrom?: string } | undefined)?.createdFrom ===
          '2026-05-01T00:00:00.000Z',
      );
      expect(called).toBe(true);
    });
  });

  // Still shortened after #2091, deliberately: the shortening moved INTO
  // `OrderIdentityCell` (its recorded deviation 4) rather than being dropped.
  // Allegro's `orderNumber` IS its 36-character `checkoutFormId`, so rendering a
  // long number verbatim — which #2091's issue text asked for — would print a
  // UUID on every Allegro row and widen the frozen Order column. The full value
  // stays reachable as the link's `title` and in the Copy button's name.
  it('should shorten a UUID-shaped order number so it reads as a reference (#939/#2091)', async () => {
    const uuidOrder: OrderRecord = {
      ...syncedOrder,
      internalOrderId: 'ol_order_uuid',
      orderSnapshot: {
        ...syncedOrder.orderSnapshot,
        orderNumber: '186d7a20-5b82-11f1-979b-098d4666d4ec',
      },
    };
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([uuidOrder])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    const link = await screen.findByText('186d7a20…66d4ec');
    expect(screen.queryByText('186d7a20-5b82-11f1-979b-098d4666d4ec')).not.toBeInTheDocument();
    // The full number is not lost — it is the link's tooltip (sighted hover) and
    // it names the Copy button (screen reader).
    expect(link).toHaveAttribute('title', '186d7a20-5b82-11f1-979b-098d4666d4ec');
    expect(
      screen.getByRole('button', {
        name: 'Copy internal order ID for order 186d7a20-5b82-11f1-979b-098d4666d4ec',
      }),
    ).toBeInTheDocument();
  });

  it('should fall back to the buyer email in the customer cell when the address has no name (#939)', async () => {
    const noNameOrder: OrderRecord = {
      ...syncedOrder,
      internalOrderId: 'ol_order_noname',
      orderSnapshot: {
        orderNumber: 'ALG-NONAME',
        customerEmail: 'buyer@allegromail.pl',
        items: [{ id: 'i1', quantity: 1, price: 10, name: 'Thing' }],
        // shippingAddress has geography but no first/last name (locker/guest order)
        shippingAddress: {
          company: null,
          address1: 'Locker POZ08A',
          city: 'Poznań',
          postalCode: '60-001',
          country: 'PL',
        },
      },
    };
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([noNameOrder])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-NONAME');
    const row = container.querySelector('.data-table__row') as HTMLElement;
    expect(within(row).getByText('buyer@allegromail.pl')).toBeInTheDocument();
  });

  it('should preview the single item name in the collapsed row (#1646)', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    const row = container.querySelector('.data-table__row') as HTMLElement;
    expect(within(row).getByText('Filtr kubełkowy AquaPro')).toBeInTheDocument();
    // Collapsed — the full "N item(s)" detail summary isn't rendered yet.
    expect(container.querySelector('.data-table__detail-row')).toBeNull();
  });

  describe('demo read-only viewer (#1667)', () => {
    const viewerSession = createAuthenticatedSessionAdapter({
      id: 'u2',
      username: 'viewer',
      email: null,
      role: 'viewer',
      permissions: ['orders:read'],
    });

    it('renders the per-row Retry visible but disabled with a read-only tooltip for a demo viewer', async () => {
      const mockApi = createMockApiClient({
        orders: { list: vi.fn().mockResolvedValue(paginated([failedOrder])) },
        connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
        system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
      });

      renderWithProviders(<OrdersListPage />, { apiClient: mockApi, sessionAdapter: viewerSession });

      await screen.findByText('ALG-FAIL');
      const retryButton = await screen.findByRole('button', { name: 'Retry' });
      expect(retryButton).toBeDisabled();
    });

    it('renders the mobile card Retry visible but disabled for a demo viewer', async () => {
      const viewport = mockMobileViewport();
      try {
        const mockApi = createMockApiClient({
          orders: { list: vi.fn().mockResolvedValue(paginated([failedOrder])) },
          connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
          system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
        });

        renderWithProviders(<OrdersListPage />, { apiClient: mockApi, sessionAdapter: viewerSession });

        await screen.findAllByText('ALG-FAIL');
        const retryButton = await screen.findByRole('button', { name: 'Retry' });
        expect(retryButton).toBeDisabled();
      } finally {
        viewport.restore();
      }
    });

    it('keeps the existing hide-when-missing behaviour for an unauthorized non-demo viewer', async () => {
      const mockApi = createMockApiClient({
        orders: { list: vi.fn().mockResolvedValue(paginated([failedOrder])) },
        connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
      });

      renderWithProviders(<OrdersListPage />, { apiClient: mockApi, sessionAdapter: viewerSession });

      await screen.findByText('ALG-FAIL');
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });
  });

  it('should preview the first item name plus a "+N more" suffix for multi-item orders (#1646)', async () => {
    const multiItemOrder: OrderRecord = {
      ...syncedOrder,
      internalOrderId: 'ol_order_multi',
      orderSnapshot: {
        ...syncedOrder.orderSnapshot,
        items: [
          { id: 'i1', quantity: 1, price: 40, name: 'Filtr kubełkowy AquaPro' },
          { id: 'i2', quantity: 2, price: 22.1, name: 'Wkład węglowy' },
          { id: 'i3', quantity: 1, price: 22.1, name: 'Uszczelka' },
        ],
      },
    };
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([multiItemOrder])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    const row = container.querySelector('.data-table__row') as HTMLElement;
    // The first item name truncates in its own span; the "+N" count is a separate
    // never-truncated chip now (#1713), so assert the two pieces independently.
    expect(within(row).getByText('Filtr kubełkowy AquaPro')).toBeInTheDocument();
    expect(within(row).getByText('+2')).toBeInTheDocument();
  });

  it('should not render an items preview line when the snapshot has no named items (#1646)', async () => {
    const noItemsOrder: OrderRecord = {
      ...syncedOrder,
      internalOrderId: 'ol_order_noitems',
      orderSnapshot: { ...syncedOrder.orderSnapshot, items: [] },
    };
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([noItemsOrder])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    const row = container.querySelector('.data-table__row') as HTMLElement;
    expect(within(row).queryByText(/more$/)).not.toBeInTheDocument();
  });

  it('should offer "Issue invoice" and "Generate label" actions for an order with neither yet (#1713)', async () => {
    // Explicit not-shipped order (the Generate-label gate needs it explicit,
    // never undefined — #1713) with no invoice, plus an invoicing-capable
    // connection so the "Issue invoice" CTA is offered rather than an em dash.
    const notShippedOrder: OrderRecord = {
      ...syncedOrder,
      fulfillmentState: 'not-shipped',
      // Live OL carrier route so the Generate-label CTA is offered (#1799).
      deliveryResolution: {
        source: 'rule',
        processorKind: 'ol_managed_carrier',
        processorConnectionId: 'conn-inpost',
        processorAvailable: true,
      },
    };
    const invoicingConnection: Connection = {
      ...sampleConnection,
      id: 'conn_invoicing_1',
      name: 'KSeF',
      enabledCapabilities: ['Invoicing'],
    };
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([notShippedOrder])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection, invoicingConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    const row = container.querySelector('.data-table__row') as HTMLElement;

    const invoiceCta = within(row).getByRole('link', { name: /issue invoice/i });
    expect(invoiceCta).toHaveAttribute('href', '/orders/ol_order_synced#invoicing');
    const labelCta = within(row).getByRole('link', { name: /generate label/i });
    expect(labelCta).toHaveAttribute('href', '/orders/ol_order_synced#shipment');
  });

  it('should show an em dash for "Issue invoice" when no connection can issue invoices (#1713)', async () => {
    const notShippedOrder: OrderRecord = {
      ...syncedOrder,
      fulfillmentState: 'not-shipped',
      // Live OL carrier route so the Generate-label CTA is offered (#1799).
      deliveryResolution: {
        source: 'rule',
        processorKind: 'ol_managed_carrier',
        processorConnectionId: 'conn-inpost',
        processorAvailable: true,
      },
    };
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([notShippedOrder])) },
      // sampleConnection has no Invoicing capability.
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    const row = container.querySelector('.data-table__row') as HTMLElement;

    expect(within(row).queryByRole('link', { name: /issue invoice/i })).not.toBeInTheDocument();
    // Generate label is still offered — it isn't invoicing-gated.
    expect(within(row).getByRole('link', { name: /generate label/i })).toBeInTheDocument();
  });

  describe('sales-document block badge + filter (#2100)', () => {
    const invoicingConnection: Connection = {
      ...sampleConnection,
      id: 'conn_invoicing_1',
      name: 'KSeF',
      enabledCapabilities: ['Invoicing'],
    };

    function blockedOrder(overrides: Partial<OrderRecord>): OrderRecord {
      return { ...syncedOrder, fulfillmentState: 'not-shipped', ...overrides };
    }

    it('should replace the "Issue invoice" CTA with the block badge', async () => {
      const mockApi = createMockApiClient({
        orders: {
          list: vi.fn().mockResolvedValue(
            paginated([
              blockedOrder({
                salesDocumentBlockReason: 'unresolved-routing',
                salesDocumentUnresolvedReason: 'ambiguous-connection-no-primary',
              }),
            ]),
          ),
        },
        connections: { list: vi.fn().mockResolvedValue([sampleConnection, invoicingConnection]) },
      });

      const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

      await screen.findByText('ALG-882414');
      const row = container.querySelector('.data-table__row') as HTMLElement;

      expect(within(row).getByText('No primary')).toBeInTheDocument();
      // The CTA must be GONE: an order OpenLinker already refused is not an order
      // waiting for a click, and the CTA alone made every cause look identical.
      expect(within(row).queryByRole('link', { name: /issue invoice/i })).not.toBeInTheDocument();
    });

    /**
     * The row must render the invoice pill and the block badge as INDEPENDENT
     * parts, not as a three-way choice (#2100 review round 4).
     *
     * `a ? pill : b ? badge : cta` made the badge unreachable behind any invoice
     * record — including a terminal REJECTED failure, the one shape the backend
     * gate, the panel, the timeline, the aggregate count and the
     * `?invoicing=blocked` filter all deliberately keep blocked. Clicking the
     * "Invoicing blocked" chip then landed the operator on rows whose only
     * visible signal was `Failed`: true, but a different fact from "auto-issue
     * was refused because no connection is primary".
     */
    const rejectedInvoice = {
      invoiceId: 'inv-1',
      status: 'failed' as const,
      regulatoryStatus: 'not-applicable' as const,
      blocksIssuanceElsewhere: false,
    };

    it('should show the block badge BESIDE a rejected invoice pill', async () => {
      const mockApi = createMockApiClient({
        orders: {
          list: vi.fn().mockResolvedValue(
            paginated([
              blockedOrder({
                salesDocumentBlockReason: 'unresolved-routing',
                salesDocumentUnresolvedReason: 'ambiguous-connection-no-primary',
                orderSnapshot: { ...syncedOrder.orderSnapshot, invoice: rejectedInvoice },
              }),
            ]),
          ),
        },
        connections: { list: vi.fn().mockResolvedValue([sampleConnection, invoicingConnection]) },
      });

      const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

      await screen.findByText('ALG-882414');
      const row = container.querySelector('.data-table__row') as HTMLElement;

      expect(within(row).getByText('Failed')).toBeInTheDocument();
      expect(within(row).getByText('No primary')).toBeInTheDocument();
      // A record exists, so the next step is Retry in the panel, not a fresh issue.
      expect(within(row).queryByRole('link', { name: /issue invoice/i })).not.toBeInTheDocument();
    });

    it('should show the block badge beside a rejected invoice on the mobile card too', async () => {
      const mockApi = createMockApiClient({
        orders: {
          list: vi.fn().mockResolvedValue(
            paginated([
              blockedOrder({
                salesDocumentBlockReason: 'unresolved-routing',
                salesDocumentUnresolvedReason: 'ambiguous-connection-no-primary',
                orderSnapshot: { ...syncedOrder.orderSnapshot, invoice: rejectedInvoice },
              }),
            ]),
          ),
        },
        connections: { list: vi.fn().mockResolvedValue([sampleConnection, invoicingConnection]) },
      });

      // The card view was the SECOND hand-written copy of the ternary, so it
      // needs its own assertion at the mobile breakpoint.
      const viewport = mockMobileViewport();
      try {
        const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

        await screen.findByText('ALG-882414');
        const card = container.querySelector('.orders-card-summary') as HTMLElement;

        expect(within(card).getByText('Failed')).toBeInTheDocument();
        expect(within(card).getByText('No primary')).toBeInTheDocument();
      } finally {
        viewport.restore();
      }
    });

    it('should still hide the badge behind an invoice that plausibly exists', async () => {
      const mockApi = createMockApiClient({
        orders: {
          list: vi.fn().mockResolvedValue(
            paginated([
              blockedOrder({
                salesDocumentBlockReason: 'unresolved-routing',
                salesDocumentUnresolvedReason: 'ambiguous-connection-no-primary',
                orderSnapshot: {
                  ...syncedOrder.orderSnapshot,
                  invoice: {
                    invoiceId: 'inv-1',
                    status: 'issued',
                    regulatoryStatus: 'accepted',
                    blocksIssuanceElsewhere: true,
                  },
                },
              }),
            ]),
          ),
        },
        connections: { list: vi.fn().mockResolvedValue([sampleConnection, invoicingConnection]) },
      });

      const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

      await screen.findByText('ALG-882414');
      const row = container.querySelector('.data-table__row') as HTMLElement;

      // "No primary" beside an issued invoice is worse than no pill at all — and
      // the backend gate refuses to persist a block here in the first place.
      expect(within(row).queryByText('No primary')).not.toBeInTheDocument();
    });

    it('should keep the "Issue invoice" CTA alongside a manual-only badge', async () => {
      const mockApi = createMockApiClient({
        orders: {
          list: vi
            .fn()
            .mockResolvedValue(
              paginated([blockedOrder({ salesDocumentBlockReason: 'trigger-model-manual' })]),
            ),
        },
        connections: { list: vi.fn().mockResolvedValue([sampleConnection, invoicingConnection]) },
      });

      const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

      await screen.findByText('ALG-882414');
      const row = container.querySelector('.data-table__row') as HTMLElement;

      expect(within(row).getByText('Manual only')).toBeInTheDocument();
      // Issuing by hand IS the configured workflow here, so the affordance stays.
      expect(within(row).getByRole('link', { name: /issue invoice/i })).toBeInTheDocument();
    });

    it('should suppress the badge when the order already carries an invoice', async () => {
      const mockApi = createMockApiClient({
        orders: {
          list: vi.fn().mockResolvedValue(
            paginated([
              blockedOrder({
                salesDocumentBlockReason: 'unresolved-routing',
                salesDocumentUnresolvedReason: 'ambiguous-connection-no-primary',
                orderSnapshot: {
                  ...syncedOrder.orderSnapshot,
                  invoice: {
                    invoiceId: 'inv-1',
                    status: 'issued',
                    regulatoryStatus: 'not-applicable',
                  },
                },
              }),
            ]),
          ),
        },
        connections: { list: vi.fn().mockResolvedValue([sampleConnection, invoicingConnection]) },
      });

      const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

      await screen.findByText('ALG-882414');
      const row = container.querySelector('.data-table__row') as HTMLElement;

      // "No primary" next to an issued invoice is worse than no badge at all, so
      // the render refuses the contradiction rather than trusting the clear to
      // have landed already.
      expect(within(row).queryByText('No primary')).not.toBeInTheDocument();
      expect(within(row).getByText('Issued')).toBeInTheDocument();
    });

    it('should offer a counted filter chip and pass the filter to the API', async () => {
      const list = vi.fn().mockResolvedValue(paginated([syncedOrder]));
      const statusSummary = vi.fn().mockResolvedValue({
        total: 3,
        sourceDeleted: 0,
        awaitingMapping: 0,
        needsAttention: 0,
        synced: 3,
        awaitingDispatch: 0,
        salesDocumentBlocked: 2,
      });
      const mockApi = createMockApiClient({ orders: { list, statusSummary } });

      renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

      const chip = await screen.findByRole('button', { name: /invoicing blocked/i });
      expect(chip).toHaveTextContent('2');

      const before = list.mock.calls.length;
      await userEvent.setup().click(chip);

      await vi.waitFor(() => {
        expect(list.mock.calls.length).toBeGreaterThan(before);
      });
      const [filters] = list.mock.calls[list.mock.calls.length - 1];
      expect(filters).toMatchObject({ salesDocumentBlocked: true });
    });

    it('should state the cause as the badge tooltip AND an accessible name', async () => {
      const mockApi = createMockApiClient({
        orders: {
          list: vi.fn().mockResolvedValue(
            paginated([
              blockedOrder({
                salesDocumentBlockReason: 'unresolved-routing',
                salesDocumentUnresolvedReason: 'ambiguous-connection-no-primary',
              }),
            ]),
          ),
        },
        connections: { list: vi.fn().mockResolvedValue([sampleConnection, invoicingConnection]) },
      });

      const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

      await screen.findByText('ALG-882414');
      const row = container.querySelector('.data-table__row') as HTMLElement;
      const wrapper = within(row).getByText('No primary').closest('span[title]');

      // The hint is the ONLY statement of why on this surface, so it must reach the
      // DOM — and `title` alone is unreachable by keyboard and unreliable in screen
      // readers on a role-less span.
      expect(wrapper).toHaveAttribute('title', expect.stringMatching(/none is set to issue/i));
      expect(wrapper).toHaveAttribute('aria-label', expect.stringContaining('No primary'));
    });

    it('should render the block badge on the mobile card path too', async () => {
      const viewport = mockMobileViewport();
      try {
        const mockApi = createMockApiClient({
          orders: {
            list: vi
              .fn()
              .mockResolvedValue(
                paginated([blockedOrder({ salesDocumentBlockReason: 'trigger-model-batched' })]),
              ),
          },
          connections: { list: vi.fn().mockResolvedValue([sampleConnection, invoicingConnection]) },
        });

        renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

        await screen.findByText('ALG-882414');
        // The card is a deliberate parallel render path — deleting its ~20
        // duplicated lines used to leave the suite green.
        expect(screen.getByText('Batched')).toBeInTheDocument();
      } finally {
        viewport.restore();
      }
    });

    it('should seed from the URL param and clear the filter when toggled off', async () => {
      const list = vi.fn().mockResolvedValue(paginated([syncedOrder]));
      const statusSummary = vi.fn().mockResolvedValue({
        total: 3,
        sourceDeleted: 0,
        awaitingMapping: 0,
        needsAttention: 0,
        synced: 3,
        awaitingDispatch: 0,
        salesDocumentBlocked: 2,
      });
      const mockApi = createMockApiClient({ orders: { list, statusSummary } });

      // URL state owns this filter (§ State Management), so a shared/bookmarked
      // link must arrive already filtered.
      renderWithProviders(<OrdersListPage />, {
        apiClient: mockApi,
        route: '/orders?invoicing=blocked&offset=20',
      });

      const chip = await screen.findByRole('button', { name: /invoicing blocked/i });
      expect(chip).toHaveAttribute('aria-pressed', 'true');
      expect(list.mock.calls[0][0]).toMatchObject({ salesDocumentBlocked: true });

      const before = list.mock.calls.length;
      await userEvent.setup().click(chip);

      await vi.waitFor(() => {
        expect(list.mock.calls.length).toBeGreaterThan(before);
      });
      const [filters, pagination] = list.mock.calls[list.mock.calls.length - 1];
      // Toggled off means "no filter", never `false` — the UI offers no
      // hide-blocked-orders mode.
      expect(filters.salesDocumentBlocked).toBeUndefined();
      // And any filter change resets the page.
      expect(pagination).toMatchObject({ offset: 0 });
    });

    it('should keep the chip mounted while the filter is active even at zero', async () => {
      const statusSummary = vi.fn().mockResolvedValue({
        total: 0,
        sourceDeleted: 0,
        awaitingMapping: 0,
        needsAttention: 0,
        synced: 0,
        awaitingDispatch: 0,
        salesDocumentBlocked: 0,
      });
      const mockApi = createMockApiClient({
        orders: { list: vi.fn().mockResolvedValue(paginated([])), statusSummary },
      });

      renderWithProviders(<OrdersListPage />, {
        apiClient: mockApi,
        route: '/orders?invoicing=blocked',
      });

      // Gating the chip on the count alone unmounted the ONLY control for this
      // param exactly when the remediation succeeded, stranding an applied filter.
      expect(
        await screen.findByRole('button', { name: /invoicing blocked/i }),
      ).toBeInTheDocument();
      // And the empty state must not claim nothing has ever synced.
      expect(screen.getByText(/Nothing is blocked from invoicing/i)).toBeInTheDocument();
      expect(screen.queryByText(/No order records have been synced yet/i)).toBeNull();
    });

    it('should clear BOTH filters from the empty-state recovery button', async () => {
      const list = vi.fn().mockResolvedValue(paginated([]));
      const statusSummary = vi.fn().mockResolvedValue({
        total: 0,
        sourceDeleted: 0,
        awaitingMapping: 0,
        needsAttention: 0,
        synced: 0,
        awaitingDispatch: 0,
        salesDocumentBlocked: 0,
      });
      const mockApi = createMockApiClient({ orders: { list, statusSummary } });

      // `needs_attention` is tested FIRST, so an order set that is both unattended
      // and invoicing-blocked lands in the "All clear" arm — the one whose button
      // used to touch only `health`.
      renderWithProviders(<OrdersListPage />, {
        apiClient: mockApi,
        route: '/orders?health=needs_attention&invoicing=blocked',
      });

      const recover = await screen.findByRole('button', { name: 'View all orders' });
      const before = list.mock.calls.length;
      await userEvent.setup().click(recover);

      await vi.waitFor(() => {
        expect(list.mock.calls.length).toBeGreaterThan(before);
      });

      // Regression guard: `setSearchParams` is NOT a queued reducer, so two calls
      // in one handler both build from the current render's params and the second
      // supersedes the first. Clearing `health` and `invoicing` separately left
      // `invoicing=blocked` applied behind a button that says "View all orders".
      const [filters] = list.mock.calls[list.mock.calls.length - 1];
      expect(filters.salesDocumentBlocked).toBeUndefined();
      expect(filters.health).toBeUndefined();
    });

    it('should hide the chip when nothing is blocked', async () => {
      const statusSummary = vi.fn().mockResolvedValue({
        total: 1,
        sourceDeleted: 0,
        awaitingMapping: 0,
        needsAttention: 0,
        synced: 1,
        awaitingDispatch: 0,
        salesDocumentBlocked: 0,
      });
      const mockApi = createMockApiClient({
        orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])), statusSummary },
      });

      renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

      await screen.findByText('ALG-882414');
      // An install that never hits this state gets no extra control.
      expect(screen.queryByRole('button', { name: /invoicing blocked/i })).not.toBeInTheDocument();
    });
  });

  it('should NOT offer "Generate label" for a not-shipped shop-fulfilled order with no OL carrier route (#1799)', async () => {
    const shopFulfilled: OrderRecord = {
      ...syncedOrder,
      fulfillmentState: 'not-shipped',
      // omp_fulfilled default → no OpenLinker label to generate.
      deliveryResolution: {
        source: 'default',
        processorKind: 'omp_fulfilled',
        processorConnectionId: null,
        processorAvailable: true,
      },
    };
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([shopFulfilled])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    const row = container.querySelector('.data-table__row') as HTMLElement;

    expect(within(row).queryByRole('link', { name: /generate label/i })).not.toBeInTheDocument();
  });

  it('should render the Ships chip but SUPPRESS the rider chip on the list (rider is non-actionable here)', async () => {
    const shopFulfilledWithRider: OrderRecord = {
      ...syncedOrder,
      fulfillmentState: 'not-shipped',
      // A source delivery method exists → the omp_fulfilled default reads as
      // shop-fulfilled (not no-method).
      sourceDeliveryMethodName: 'Kurier InPost',
      // omp_fulfilled default → shop-fulfilled outcome.
      deliveryResolution: {
        source: 'default',
        processorKind: 'omp_fulfilled',
        processorConnectionId: null,
        processorAvailable: true,
      },
      // A rider is present, but on the list it's a non-actionable label - the
      // actionable banner + button live on the order-detail Delivery panel.
      deliveryRider: {
        rider: 'unmapped',
        candidateCarrier: { platformType: 'inpost', displayName: 'InPost' },
      },
    };
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([shopFulfilledWithRider])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    const row = container.querySelector('.data-table__row') as HTMLElement;

    // The outcome chip is present, the rider chip label is not.
    expect(within(row).getByText('Not via OpenLinker')).toBeInTheDocument();
    expect(within(row).queryByText('Unmapped')).not.toBeInTheDocument();
  });

  it('should show status pills (not actions) once an invoice exists and the order is dispatched (#1713)', async () => {
    const richOrder: OrderRecord = {
      ...syncedOrder,
      internalOrderId: 'ol_order_rich',
      fulfillmentState: 'dispatched',
      orderSnapshot: {
        ...syncedOrder.orderSnapshot,
        invoice: {
          invoiceId: 'rec-1',
          status: 'issued',
          regulatoryStatus: 'accepted',
          clearanceReference: 'KSEF-1',
          confirmationDocumentAvailable: true,
        },
      },
    };
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([richOrder])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    const row = container.querySelector('.data-table__row') as HTMLElement;

    expect(within(row).queryByRole('link', { name: /issue invoice/i })).not.toBeInTheDocument();
    expect(within(row).queryByRole('link', { name: /generate label/i })).not.toBeInTheDocument();
    expect(within(row).getByText('Cleared')).toBeInTheDocument();
    expect(within(row).getByText('Dispatched')).toBeInTheDocument();
  });
});

/**
 * Shared Order identity cell (#2091) — the Order column and the mobile card
 * title both render `OrderIdentityCell` now, and the five channel-label
 * consumers on this page all resolve through the plugin registry (#2088).
 */
describe('OrdersListPage — shared Order identity cell (#2091)', () => {
  const erliConnection: Connection = {
    ...sampleConnection,
    id: 'conn_erli_1',
    name: 'Erli Shop',
    platformType: 'erli',
  };
  const wooConnection: Connection = {
    ...sampleConnection,
    id: 'conn_woo_1',
    name: 'Woo Shop',
    platformType: 'woocommerce',
  };
  /**
   * Source `erli`, destination `woocommerce` — the two platforms the deleted
   * four-entry `CHANNEL_LABELS` map had no row for, so a consumer still reading
   * a local map renders `erli` / `woocommerce` raw and lowercase here.
   */
  const crossChannelOrder: OrderRecord = {
    ...syncedOrder,
    internalOrderId: 'ol_order_crosschannel',
    sourceConnectionId: 'conn_erli_1',
    syncStatus: [{ ...syncedOrder.syncStatus[0], destinationConnectionId: 'conn_woo_1' }],
  };

  function mockCrossChannelApi(): ReturnType<typeof createMockApiClient> {
    return createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([crossChannelOrder])) },
      connections: { list: vi.fn().mockResolvedValue([erliConnection, wooConnection]) },
    });
  }

  afterEach(() => {
    cleanup();
    // One test stubs `navigator` for the clipboard; without this the stub leaks
    // into every test after it in the file.
    vi.unstubAllGlobals();
  });

  it('renders the Order column through OrderIdentityCell, thumbnail included', async () => {
    const withImage: OrderRecord = {
      ...syncedOrder,
      orderSnapshot: {
        ...syncedOrder.orderSnapshot,
        items: [
          {
            id: 'i1',
            quantity: 1,
            price: 84.2,
            name: 'Filtr kubełkowy AquaPro',
            imageUrl: 'https://cdn.example.test/filtr.jpg',
          },
        ],
      },
    };
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([withImage])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    const table = await screen.findByRole('table');
    const cell = table.querySelector('.order-cell') as HTMLElement;
    expect(cell).not.toBeNull();
    // The thumbnail is what this column never had (#1996 frame 04).
    expect(cell.querySelector('.product-thumbnail img')).toHaveAttribute(
      'src',
      'https://cdn.example.test/filtr.jpg',
    );
    expect(within(cell).getByRole('link', { name: 'ALG-882414' })).toHaveAttribute(
      'href',
      '/orders/ol_order_synced',
    );
    expect(within(cell).getByText('Filtr kubełkowy AquaPro')).toBeInTheDocument();
    expect(container.querySelector('.orders-cell-stack .order-cell')).not.toBeNull();
  });

  it('no longer renders the entity-label__id chip inside the Order cell', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    const cell = container.querySelector('.order-cell') as HTMLElement;
    // The shortened id is the NAME's fallback now, so it must never sit beside a
    // real order number competing with it.
    expect(cell.querySelector('.entity-label__id')).toBeNull();
    expect(container.querySelector('.entity-label__id')).toBeNull();
  });

  it('copies the FULL internal order id, not the shortened display form', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const longIdOrder: OrderRecord = {
      ...syncedOrder,
      internalOrderId: 'ol_order_a3f24b09c4d1486789abcdef01234567',
    };
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([longIdOrder])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    const table = await screen.findByRole('table');
    fireEvent.click(
      within(table).getByRole('button', {
        name: 'Copy internal order ID for order ALG-882414',
      }),
    );

    expect(writeText).toHaveBeenCalledWith('ol_order_a3f24b09c4d1486789abcdef01234567');
  });

  it('counts EVERY line item in the +N chip, not only the named ones', async () => {
    // Pre-#2091 the page derived `+N` from `itemsSummary()`, which dropped the
    // nameless lines BEFORE counting — so this order read `+0` here while the
    // same order read `+2` on Shipments and Invoices (`buildOrderSummary`, #1995).
    const partiallyNamed: OrderRecord = {
      ...syncedOrder,
      internalOrderId: 'ol_order_partial',
      orderSnapshot: {
        ...syncedOrder.orderSnapshot,
        items: [
          { id: 'i1', quantity: 1, price: 40, name: 'Filtr kubełkowy AquaPro' },
          { id: 'i2', quantity: 1, price: 22.1 },
          { id: 'i3', quantity: 1, price: 22.1 },
        ],
      },
    };
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([partiallyNamed])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    const cell = container.querySelector('.order-cell') as HTMLElement;
    expect(within(cell).getByText('+2')).toBeInTheDocument();
  });

  it('states the line count as a sentence when the first item carries no name', async () => {
    // `buildOrderSummary` projects the FIRST item, not the first NAMED one, so
    // the page feeds item[0] verbatim to stay identical to the other two lists.
    // The cell then keeps the known count rather than dropping it (its own
    // recorded deviation 2 from the mockup).
    const namelessLead: OrderRecord = {
      ...syncedOrder,
      internalOrderId: 'ol_order_nameless',
      orderSnapshot: {
        ...syncedOrder.orderSnapshot,
        items: [
          { id: 'i1', quantity: 1, price: 40 },
          { id: 'i2', quantity: 1, price: 22.1, name: 'Wkład węglowy' },
        ],
      },
    };
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([namelessLead])) },
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    const cell = container.querySelector('.order-cell') as HTMLElement;
    expect(within(cell).getByText('2 line items')).toBeInTheDocument();
    expect(within(cell).queryByText('Wkład węglowy')).not.toBeInTheDocument();
  });

  it('renders the mobile card title from the SAME cell as the desktop column', async () => {
    const viewport = mockMobileViewport();
    // Asserting the Copy button EXISTS on the card is not asserting it works —
    // and "works" is what the no-`rowHref` premise below buys (#2090 shipped a
    // card whose Copy copied AND navigated away).
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      const mockApi = createMockApiClient({
        orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])) },
        connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
      });

      const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

      await screen.findAllByText('ALG-882414');
      expect(container.querySelector('table')).toBeNull();

      const title = container.querySelector('.data-table__card-title') as HTMLElement;
      const cell = title.querySelector('.order-cell') as HTMLElement;
      expect(cell).not.toBeNull();
      expect(cell.querySelector('.product-thumbnail')).not.toBeNull();
      expect(cell.querySelector('.entity-label__id')).toBeNull();
      // The load-bearing premise, pinned rather than assumed: `DataTableCard`
      // wraps `title` + `subtitle` in the row's `<Link>` only when a `rowHref`
      // exists, and this page passes none. Adding one would nest this cell's own
      // link and button inside an anchor — invalid, and the clicks would bubble to
      // the card link, which is exactly the bug #2090 shipped. Every assertion
      // below still passes on that broken shape, so this is the one that fails.
      expect(title.closest('a')).toBeNull();
      // The card is not `rowHref`-linked (this page uses `expandable`), so the
      // cell's own link and Copy button are legal here — and they are the point:
      // the pre-#2091 card had its own hand-rolled `EntityLabel`.
      expect(within(cell).getByRole('link', { name: 'ALG-882414' })).toHaveAttribute(
        'href',
        '/orders/ol_order_synced',
      );
      fireEvent.click(within(cell).getByRole('button', { name: /^Copy internal order ID/ }));
      expect(writeText).toHaveBeenCalledWith('ol_order_synced');
      // The item name now belongs to the title, so the summary block must not
      // print it a second time twenty pixels lower.
      const card = container.querySelector('.data-table__card') as HTMLElement;
      expect(within(card).getAllByText('Filtr kubełkowy AquaPro')).toHaveLength(1);
    } finally {
      viewport.restore();
    }
  });

  it('captures demo_order_opened from the mobile card title link', async () => {
    const viewport = mockMobileViewport();
    try {
      const mockApi = createMockApiClient({
        orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])) },
        connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
      });
      captureDemoEvent.mockClear();

      const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

      await screen.findAllByText('ALG-882414');
      const title = container.querySelector('.data-table__card-title') as HTMLElement;
      fireEvent.click(within(title).getByRole('link', { name: 'ALG-882414' }));

      expect(captureDemoEvent).toHaveBeenCalledWith('demo_order_opened', {});
    } finally {
      viewport.restore();
    }
  });

  it('keeps the folded channel pill under the order name, with its registry label', async () => {
    // The fold is CSS-driven (`.orders-order-channel`, hidden ≥1024px) and
    // #2094 owns relocating it — this pins that #2091 left the render branch and
    // its `→ dest +N` sibling in place, INSIDE the order cell's stack.
    const mockApi = mockCrossChannelApi();

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    const stack = container.querySelector('.orders-cell-stack') as HTMLElement;
    const fold = stack.querySelector('.orders-order-channel') as HTMLElement;
    expect(fold).not.toBeNull();
    expect(fold.querySelector('.channel-pill[data-channel="erli"]')?.textContent).toBe('Erli');
    expect(within(fold).getByText('→ WooCommerce')).toBeInTheDocument();
    // The fold is a SIBLING of the identity cell, not inside its body.
    expect(fold.closest('.order-cell')).toBeNull();
  });

  it('resolves the standalone Channel column label from the registry', async () => {
    const mockApi = mockCrossChannelApi();

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    // Two `erli` pills render on the desktop row — the order cell's fold and the
    // Channel column. Exclude the fold to assert the column's own lookup.
    const columnPill = Array.from(
      container.querySelectorAll('.channel-pill[data-channel="erli"]'),
    ).find((pill) => pill.closest('.orders-order-channel') === null);
    expect(columnPill?.textContent).toBe('Erli');
    expect(columnPill?.parentElement?.textContent).toContain('→ WooCommerce');
  });

  it('resolves the mobile-card subtitle channel label from the registry', async () => {
    const viewport = mockMobileViewport();
    try {
      const mockApi = mockCrossChannelApi();

      const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

      await screen.findAllByText('ALG-882414');
      const subtitle = container.querySelector('.orders-card-sub') as HTMLElement;
      expect(subtitle.querySelector('.channel-pill[data-channel="erli"]')?.textContent).toBe('Erli');
      expect(within(subtitle).getByText('→ WooCommerce')).toBeInTheDocument();
    } finally {
      viewport.restore();
    }
  });

  it('resolves the bulk-dispatch per-row source label from the registry', async () => {
    const user = userEvent.setup();
    const mockApi = mockCrossChannelApi();

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    await user.click(screen.getByRole('checkbox', { name: 'Select ol_order_crosschannel' }));
    await user.click(screen.getByRole('button', { name: 'Dispatch 1' }));

    // The dialog portals outside the render container, so query the document.
    const source = document.querySelector('.bulk-dispatch__src') as HTMLElement;
    expect(source).not.toBeNull();
    expect(source.textContent).toBe('Erli');
  });

  it('resolves the row-detail Destination label from the registry', async () => {
    const user = userEvent.setup();
    const mockApi = mockCrossChannelApi();

    const { container } = renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    await user.click(
      screen.getByRole('button', { name: /Expand details for order ol_order_crosschannel/ }),
    );

    const detail = container.querySelector('.orders-detail') as HTMLElement;
    expect(within(detail).getByText('WooCommerce')).toBeInTheDocument();
  });
});

describe('OrdersListPage — lifecycle phase (#2310)', () => {
  afterEach(cleanup);

  const phaseSummary = {
    total: 3,
    cancelled: 0,
    vendorAuthoritative: 0,
    delivered: 0,
    inTransit: 0,
    fulfillmentFailed: 0,
    held: 0,
    amending: 0,
    blocked: 2,
    ready: 1,
  };

  it('should render the phase badge BESIDE the health badge, not instead of it', async () => {
    // AC1 / ADR-059 — health answers "is something wrong", the phase answers
    // "what stage is it at". Both must be readable on the same row.
    const blocked: OrderRecord = { ...syncedOrder, lifecyclePhase: 'blocked' };
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([blocked])) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    await screen.findByText('ALG-882414');
    const row = screen.getByText('ALG-882414').closest('tr') as HTMLElement;
    expect(within(row).getByText('Synced')).toBeInTheDocument();
    expect(within(row).getByText('Blocked')).toBeInTheDocument();
  });

  it('should render nothing for a payload predating the phase field', async () => {
    const mockApi = createMockApiClient({
      orders: { list: vi.fn().mockResolvedValue(paginated([syncedOrder])) },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    const row = (await screen.findByText('ALG-882414')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Synced')).toBeInTheDocument();
    expect(within(row).queryByText('Ready')).toBeNull();
  });

  it('should hide a zero-count chip and render the ones with orders behind them', async () => {
    const mockApi = createMockApiClient({
      orders: {
        list: vi.fn().mockResolvedValue(paginated([syncedOrder])),
        lifecycleSummary: vi.fn().mockResolvedValue(phaseSummary),
      },
    });

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    expect(await screen.findByRole('button', { name: /Blocked 2/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ready 1/ })).toBeInTheDocument();
    // Structurally 0 until Waves 2/4 supply a producer — a dead control, so hidden.
    expect(screen.queryByRole('button', { name: /On hold/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Change pending/ })).toBeNull();
  });

  it('should set ?phase= when a chip is clicked and clear it when clicked again', async () => {
    // AC2 — the round trip, including the deselect that must restore the full list.
    const list = vi.fn().mockResolvedValue(paginated([syncedOrder]));
    const mockApi = createMockApiClient({
      orders: { list, lifecycleSummary: vi.fn().mockResolvedValue(phaseSummary) },
    });
    const user = userEvent.setup();

    renderWithProviders(<OrdersListPage />, { apiClient: mockApi });

    const chip = await screen.findByRole('button', { name: /Blocked 2/ });
    await user.click(chip);

    await vi.waitFor(() => {
      expect(list.mock.calls[list.mock.calls.length - 1][0]).toMatchObject({ phase: 'blocked' });
    });
    expect(captureDemoEvent).toHaveBeenCalledWith('demo_orders_filtered', {
      filter: 'phase',
      value: 'blocked',
    });

    await user.click(await screen.findByRole('button', { name: /Blocked 2/ }));

    await vi.waitFor(() => {
      const [filters, pagination] = list.mock.calls[list.mock.calls.length - 1];
      expect(filters.phase).toBeUndefined();
      // Any filter change resets paging (the documented one-write rule).
      expect(pagination).toMatchObject({ offset: 0 });
    });
  });

  it('should arrive already filtered from a bookmarked ?phase= link and keep the chip mounted at zero', async () => {
    const list = vi.fn().mockResolvedValue(paginated([]));
    const mockApi = createMockApiClient({
      orders: {
        list,
        lifecycleSummary: vi.fn().mockResolvedValue({ ...phaseSummary, total: 0, blocked: 0 }),
      },
    });

    renderWithProviders(<OrdersListPage />, {
      apiClient: mockApi,
      route: '/orders?phase=blocked',
    });

    // Gating on the count alone would unmount the only control for an applied
    // filter exactly when its last order moved on (#2100's lesson).
    const chip = await screen.findByRole('button', { name: /Blocked/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(list.mock.calls[0][0]).toMatchObject({ phase: 'blocked' });
  });

  it('should ignore an unrecognised phase in the URL rather than passing it through', async () => {
    const list = vi.fn().mockResolvedValue(paginated([syncedOrder]));
    const mockApi = createMockApiClient({ orders: { list } });

    renderWithProviders(<OrdersListPage />, {
      apiClient: mockApi,
      route: '/orders?phase=returned',
    });

    await screen.findByText('ALG-882414');
    // A stale bookmark shows the operator their orders, not a server rejection.
    expect(list.mock.calls[0][0].phase).toBeUndefined();
  });
});
