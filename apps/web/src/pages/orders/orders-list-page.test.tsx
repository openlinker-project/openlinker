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
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient, createAuthenticatedSessionAdapter } from '../../test/test-utils';
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

  it('should shorten a UUID-shaped order number so it reads as a reference (#939)', async () => {
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

    expect(await screen.findByText('186d7a20…66d4ec')).toBeInTheDocument();
    expect(screen.queryByText('186d7a20-5b82-11f1-979b-098d4666d4ec')).not.toBeInTheDocument();
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
