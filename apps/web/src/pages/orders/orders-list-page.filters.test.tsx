/**
 * OrdersListPage — search + filter bar (#3507, mockup m4b-orders-filters)
 *
 * The Filters side panel (#4026, a bottom sheet on phones), the active-filter
 * pills, "Needs a look", keyboard shortcuts, the header button group, and the
 * viewer's read-only list (U5). URL semantics are unchanged from the toolbar
 * these replace, so every assertion is on what reaches `orders.list`.
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import type { Connection } from '../../features/connections';
import type { OrderFilters, OrderRecord, PaginatedOrders } from '../../features/orders/api/orders.types';
import { OrdersListPage } from './orders-list-page';

vi.mock('../../features/demo', () => ({ captureDemoEvent: vi.fn() }));

const connection: Connection = {
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

const order: OrderRecord = {
  internalOrderId: 'ol_order_1',
  customerId: null,
  sourceConnectionId: 'conn_allegro_1',
  sourceEventId: null,
  orderSnapshot: {
    orderNumber: 'ALG-1',
    items: [{ id: 'i1', quantity: 1, price: 10, name: 'Thing' }],
    totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
  },
  syncStatus: [],
  syncAttempts: [],
  recordStatus: 'ready',
  createdAt: '2026-01-15T10:00:00.000Z',
  updatedAt: '2026-01-15T10:00:00.000Z',
};

function paginated(items: OrderRecord[]): PaginatedOrders {
  return { items, total: items.length, limit: 20, offset: 0 };
}

function lastFilters(list: ReturnType<typeof vi.fn>): OrderFilters {
  return list.mock.calls[list.mock.calls.length - 1][0] as OrderFilters;
}

function setup(route = '/orders', session = createAuthenticatedSessionAdapter()) {
  const list = vi.fn().mockResolvedValue(paginated([order]));
  const mockApi = createMockApiClient({
    orders: { list },
    connections: { list: vi.fn().mockResolvedValue([connection]) },
  });
  const utils = renderWithProviders(<OrdersListPage />, {
    apiClient: mockApi,
    route,
    sessionAdapter: session,
  });
  return { list, ...utils };
}

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

beforeEach(() => {
  window.localStorage.removeItem('ol.orders-list.filters-open.v1');
});
afterEach(cleanup);

describe('OrdersListPage filter bar', () => {
  it('should open the Filters side panel with its sections when the toggle is pressed', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText('ALG-1');
    const toggle = screen.getByTestId('orders-filter-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog', { name: 'All filters' })).not.toBeInTheDocument();

    await user.click(toggle);

    const panel = await screen.findByRole('dialog', { name: 'All filters' });
    for (const section of ['Source & dates', 'Shipment', 'Exceptions', 'Tags', 'Stage']) {
      expect(within(panel).getByText(section)).toBeInTheDocument();
    }
  });

  it('should show a chip per active filter and remove only that filter when its × is pressed', async () => {
    const user = userEvent.setup();
    const { list } = setup('/orders?sourceConnectionId=conn_allegro_1&fulfillmentState=not-shipped&offset=20');
    await screen.findByText('ALG-1');
    const chips = screen.getByRole('group', { name: 'Active filters' });
    expect(within(chips).getByText('Allegro Store')).toBeInTheDocument();

    await user.click(
      within(chips).getByRole('button', { name: 'Remove filter Source: Allegro Store' }),
    );

    await waitFor(() => {
      expect(lastFilters(list).sourceConnectionId).toBeUndefined();
    });
    expect(lastFilters(list).fulfillmentState).toBe('not-shipped');
    expect(list.mock.calls[list.mock.calls.length - 1][1]).toMatchObject({ offset: 0 });
  });

  it('should clear every filter in one go when Clear all is pressed', async () => {
    const user = userEvent.setup();
    const { list } = setup('/orders?sourceConnectionId=conn_allegro_1&invoicing=blocked&tag=t1&due=breaching');
    await screen.findByText('ALG-1');

    await user.click(
      within(screen.getByRole('group', { name: 'Active filters' })).getByRole('button', {
        name: 'Clear all',
      }),
    );

    await waitFor(() => {
      const f = lastFilters(list);
      expect(f.sourceConnectionId).toBeUndefined();
      expect(f.salesDocumentBlocked).toBeUndefined();
      expect(f.tag).toBeUndefined();
      expect(f.dueBefore).toBeUndefined();
    });
    expect(screen.queryByRole('group', { name: 'Active filters' })).not.toBeInTheDocument();
  });

  it('should send hasBuyerNote=true to the server from "Buyer left a note" in Needs a look', async () => {
    const user = userEvent.setup();
    const { list } = setup();
    await screen.findByText('ALG-1');
    expect(lastFilters(list).hasBuyerNote).toBeUndefined();

    await user.click(screen.getByRole('button', { name: /to handle/ }));
    await user.click(await screen.findByRole('button', { name: /^Buyer left a note/ }));

    await waitFor(() => {
      expect(lastFilters(list).hasBuyerNote).toBe(true);
    });
    expect(screen.getByRole('button', { name: /^Buyer left a note/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('should read hasBuyerNote from the URL so the filter survives a reload', async () => {
    const user = userEvent.setup();
    const { list } = setup('/orders?hasBuyerNote=true');
    await screen.findByText('ALG-1');

    expect(lastFilters(list).hasBuyerNote).toBe(true);
    await user.click(screen.getByRole('button', { name: /to handle/ }));
    expect(await screen.findByRole('button', { name: /^Buyer left a note/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('should show the buyer-note indicator on a row only when the order has a note', async () => {
    const list = vi
      .fn()
      .mockResolvedValue(paginated([{ ...order, hasBuyerNote: true }]));
    renderWithProviders(<OrdersListPage />, {
      apiClient: createMockApiClient({
        orders: { list },
        connections: { list: vi.fn().mockResolvedValue([connection]) },
      }),
      route: '/orders',
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await screen.findByText('ALG-1');

    expect((await screen.findAllByTestId('order-buyer-note-hint')).length).toBeGreaterThan(0);
  });

  it('should send packed=false when "Not packed yet" is chosen in the panel', async () => {
    const user = userEvent.setup();
    const { list } = setup();
    await screen.findByText('ALG-1');
    await user.click(screen.getByTestId('orders-filter-toggle'));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Packing' }), 'false');

    await waitFor(() => {
      expect(lastFilters(list).packed).toBe(false);
    });
  });

  it('should filter by SLA when a Ship-by segment is chosen in the panel', async () => {
    const user = userEvent.setup();
    const { list } = setup();
    await screen.findByText('ALG-1');
    await user.click(screen.getByTestId('orders-filter-toggle'));

    await user.click(screen.getByRole('radio', { name: 'Overdue' }));

    await waitFor(() => {
      expect(lastFilters(list).slaState).toBe('overdue');
    });
  });

  it('should focus the search box when "/" is pressed outside a field', async () => {
    setup();
    await screen.findByText('ALG-1');
    fireEvent.keyDown(document.body, { key: '/' });
    expect(screen.getByRole('searchbox', { name: 'Search orders' })).toHaveFocus();
  });

  it('should open the panel when "F" is pressed and ignore it while typing in search', async () => {
    setup();
    await screen.findByText('ALG-1');

    const search = screen.getByRole('searchbox', { name: 'Search orders' });
    fireEvent.keyDown(search, { key: 'f' });
    expect(screen.queryByRole('dialog', { name: 'All filters' })).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'f' });
    expect(await screen.findByRole('dialog', { name: 'All filters' })).toBeInTheDocument();
  });

  it('should keep the header actions on one row inside a button group', async () => {
    setup();
    await screen.findByText('ALG-1');
    const refresh = screen.getByRole('button', { name: /^Refresh/ });
    const group = refresh.closest('.button-group');
    expect(group).not.toBeNull();
    expect(within(group as HTMLElement).getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('should render no row checkboxes when the viewer cannot write orders (U5)', async () => {
    setup(
      '/orders',
      createAuthenticatedSessionAdapter({
        id: 'u2',
        username: 'viewer',
        email: null,
        role: 'viewer',
        permissions: ['orders:read'],
      }),
    );
    await screen.findByText('ALG-1');
    expect(screen.queryByRole('checkbox', { name: 'Select ol_order_1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Select all visible orders' })).not.toBeInTheDocument();
  });

  it('should offer row checkboxes and an Export N bulk action when the user can write and export', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText('ALG-1');
    await user.click(await screen.findByRole('checkbox', { name: 'Select ol_order_1' }));
    expect(screen.getByRole('button', { name: 'Export 1' })).toBeInTheDocument();
  });

  it('should open the filters as a bottom sheet on a phone and close it from "Show N orders"', async () => {
    const viewport = mockMobileViewport();
    try {
      const user = userEvent.setup();
      setup();
      await screen.findAllByText('ALG-1');
      await user.click(screen.getByTestId('orders-filter-toggle'));
      const sheet = await screen.findByRole('dialog', { name: 'All filters' });
      expect(within(sheet).getByText('Source & dates')).toBeInTheDocument();
      await user.click(within(sheet).getByRole('button', { name: 'Show 1 order' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'All filters' })).not.toBeInTheDocument();
      });
    } finally {
      viewport.restore();
    }
  });

  it('should not promise buyer or email search when the install stores no personal data (G03-14)', async () => {
    renderWithProviders(<OrdersListPage />, {
      apiClient: createMockApiClient({
        orders: { list: vi.fn().mockResolvedValue(paginated([order])) },
        system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false, storesPersonalData: false }) },
      }),
      route: '/orders',
    });
    const search = await screen.findByRole('searchbox', { name: 'Search orders' });
    await waitFor(() => {
      expect(search).toHaveAttribute('placeholder', 'Search by order number, SKU or tracking number…');
    });
  });

  it('should promise buyer and email search when the install stores personal data', async () => {
    renderWithProviders(<OrdersListPage />, {
      apiClient: createMockApiClient({
        orders: { list: vi.fn().mockResolvedValue(paginated([order])) },
        system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false, storesPersonalData: true }) },
      }),
      route: '/orders',
    });
    expect(await screen.findByRole('searchbox', { name: 'Search orders' })).toHaveAttribute(
      'placeholder',
      'Search by order number, buyer, email, SKU or tracking number…',
    );
  });

  it('should quote the query back with typographic quotes when a search finds nothing', async () => {
    const list = vi.fn().mockResolvedValue(paginated([]));
    renderWithProviders(<OrdersListPage />, {
      apiClient: createMockApiClient({ orders: { list } }),
      route: '/orders?search=kulus',
    });
    expect(await screen.findByText('No orders match “kulus”')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
  });
});
