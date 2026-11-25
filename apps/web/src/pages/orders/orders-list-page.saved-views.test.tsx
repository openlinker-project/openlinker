/**
 * OrdersListPage - saved views (#4241)
 *
 * The Orders list on the saved-views engine: the built-in views replace the
 * health tabs, sort travels as `sort` + `dir`, the Columns panel replaces the
 * preset control, and `VITE_OL_ORDERS_SAVED_VIEWS_ENABLED=false` brings the
 * previous list back.
 */
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import type { SessionUser } from '../../shared/auth/session.types';
import type { Connection } from '../../features/connections';
import type {
  OrderFilters,
  OrderHealthSummary,
  OrderRecord,
  PaginatedOrders,
} from '../../features/orders/api/orders.types';
import { LEGACY_VISIBLE_COLUMNS_STORAGE_KEY } from '../../features/orders/lib/legacy-visible-columns';
import type { SavedView } from '../../features/saved-views';
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

function makeOrder(id: string): OrderRecord {
  return {
    internalOrderId: id,
    customerId: null,
    sourceConnectionId: 'conn_allegro_1',
    sourceEventId: null,
    orderSnapshot: {
      orderNumber: `NUM-${id}`,
      items: [{ id: 'i1', quantity: 1, price: 10, name: 'Thing' }],
      totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
      shippingAddress: {
        firstName: 'Anna',
        lastName: 'Kowalska',
        address1: 'ul. Testowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'PL',
      },
    },
    syncStatus: [],
    syncAttempts: [],
    recordStatus: 'ready',
    createdAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-01-15T10:00:00.000Z',
  };
}

const summary: OrderHealthSummary = {
  total: 120,
  sourceDeleted: 2,
  awaitingMapping: 7,
  needsAttention: 11,
  synced: 60,
  awaitingDispatch: 40,
};

function paginated(items: OrderRecord[]): PaginatedOrders {
  return { items, total: items.length, limit: 20, offset: 0 };
}

function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}
const params = (): URLSearchParams => new URLSearchParams(screen.getByTestId('location').textContent ?? '');

/** The engine writes the default view to the address right after first paint; give it a beat. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

const OPERATOR: SessionUser = {
  id: 'u_operator',
  username: 'operator',
  email: 'operator@example.com',
  role: 'operator',
  permissions: ['orders:read', 'orders:write'],
  analyticsConsent: true,
};

function setup(
  options: { route?: string; orders?: OrderRecord[]; savedViews?: SavedView[]; user?: SessionUser } = {},
) {
  const list = vi.fn().mockResolvedValue(paginated(options.orders ?? [makeOrder('ol_1')]));
  const mockApi = createMockApiClient({
    orders: { list, statusSummary: vi.fn().mockResolvedValue(summary) },
    connections: { list: vi.fn().mockResolvedValue([connection]) },
    savedViews: { list: vi.fn().mockResolvedValue(options.savedViews ?? []) },
  });
  renderWithProviders(
    <>
      <OrdersListPage />
      <LocationProbe />
    </>,
    {
      apiClient: mockApi,
      route: options.route ?? '/orders',
      sessionAdapter: createAuthenticatedSessionAdapter(options.user),
    },
  );
  return { list };
}

const viewStrip = (): ReturnType<typeof within> => within(screen.getByRole('group', { name: 'Views' }));
const lastFilters = (list: ReturnType<typeof vi.fn>): OrderFilters =>
  list.mock.calls[list.mock.calls.length - 1][0] as OrderFilters;

beforeEach(() => {
  window.localStorage.removeItem('ol.orders-list.filters-open.v1');
  window.localStorage.removeItem(LEGACY_VISIBLE_COLUMNS_STORAGE_KEY);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('OrdersListPage saved views (#4241)', () => {
  it('should apply the built-in All view to the address, with the sort in the list\'s own spelling', async () => {
    setup();

    await screen.findByText('NUM-ol_1');
    await waitFor(() => expect(params().get('view')).toBe('all'));
    expect(params().get('sort')).toBe('createdAt');
    expect(params().get('dir')).toBe('desc');
    expect(viewStrip().getByRole('button', { name: /^All orders/ })).toHaveAttribute('aria-current', 'true');
  });

  it('should show the health buckets as views with the summary counts and no health tabs', async () => {
    setup();

    await screen.findByText('NUM-ol_1');
    await waitFor(() => expect(viewStrip().getByRole('button', { name: /^Needs attention/ })).toHaveTextContent('11'));
    expect(viewStrip().getByRole('button', { name: /^Awaiting dispatch/ })).toHaveTextContent('40');
    expect(viewStrip().getByRole('button', { name: /^All orders/ })).toHaveTextContent('120');
    expect(screen.queryByRole('tab', { name: /Needs attention/ })).toBeNull();
  });

  it('should write the filter, the view and the sort as sort + dir when a view is picked', async () => {
    const user = userEvent.setup();
    const { list } = setup();

    await screen.findByText('NUM-ol_1');
    await settle();
    await user.click(await viewStrip().findByRole('button', { name: /^Awaiting dispatch/ }));

    await waitFor(() => expect(params().get('health')).toBe('awaiting_dispatch'));
    expect(params().get('view')).toBe('awaiting_dispatch');
    expect(params().get('sort')).toBe('dispatchBy');
    expect(params().get('dir')).toBe('asc');
    await waitFor(() => {
      expect(lastFilters(list)).toMatchObject({ health: 'awaiting_dispatch', sort: 'dispatchBy', dir: 'asc' });
    });
  });

  it('should keep a bookmark with sort and dir as the list reads it', async () => {
    const { list } = setup({ route: '/orders?sort=total&dir=asc&health=synced' });

    await screen.findByText('NUM-ol_1');
    await waitFor(() => expect(lastFilters(list)).toMatchObject({ health: 'synced', sort: 'total', dir: 'asc' }));
    expect(params().get('sort')).toBe('total');
    expect(params().get('dir')).toBe('asc');
    // A deep link naming no view is shown against the built-in view that says the same filters.
    expect(viewStrip().getByRole('button', { name: /^Synced/ })).toHaveAttribute('aria-current', 'true');
  });

  it('should drop the offset when a view is picked', async () => {
    const user = userEvent.setup();
    setup({ route: '/orders?health=synced&offset=20' });

    await screen.findByText('NUM-ol_1');
    await settle();
    await user.click(await viewStrip().findByRole('button', { name: /^Source deleted/ }));

    await waitFor(() => expect(params().get('health')).toBe('source_deleted'));
    expect(params().has('offset')).toBe(false);
  });

  it('should hide a column from the Columns panel', async () => {
    const user = userEvent.setup();
    setup();

    await screen.findByText('NUM-ol_1');
    await settle();
    expect(await screen.findByRole('columnheader', { name: /Channel/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Columns & sort/ }));
    await user.click(await screen.findByRole('checkbox', { name: /Channel/ }));

    await waitFor(() => expect(screen.queryByRole('columnheader', { name: /Channel/ })).toBeNull());
    // Hiding a column edits the draft; the strip says so.
    expect(await screen.findByRole('button', { name: 'Save as view…' })).toBeInTheDocument();
  });

  it('should reorder the fields of the stacked money column and its header follows', async () => {
    const user = userEvent.setup();
    setup();

    await screen.findByText('NUM-ol_1');
    await settle();
    await user.click(await screen.findByRole('button', { name: /Columns & sort/ }));
    // Open the fields of the money column, then move Payment above Total.
    const dialog = await screen.findByRole('dialog');
    const disclosures = within(dialog).getAllByRole('button', { name: /Fields/ });
    await user.click(disclosures[disclosures.length - 1]);
    await user.click(await within(dialog).findByRole('button', { name: 'Move Payment up' }));
    // The open panel hides the table from assistive tech; close it to read the header.
    await user.click(within(dialog).getAllByRole('button', { name: 'Done' })[0]);

    const money = await screen.findByRole('columnheader', { name: /Total/ });
    const labels = within(money).getAllByRole('button').map((button) => button.textContent);
    expect(labels.indexOf('Payment')).toBeLessThan(labels.indexOf('Total'));
  });

  it('should clear the selection when the view changes', async () => {
    const user = userEvent.setup();
    setup({ user: OPERATOR });

    await screen.findByText('NUM-ol_1');
    await settle();
    await user.click(await screen.findByRole('checkbox', { name: 'Select ol_1' }));
    expect(await screen.findByTestId('orders-bulk-bar')).toBeInTheDocument();

    await user.click(viewStrip().getByRole('button', { name: /^Synced/ }));

    await waitFor(() => expect(screen.queryByTestId('orders-bulk-bar')).toBeNull());
  });

  describe('the column choice the list used to keep in localStorage', () => {
    it('should seed the draft once and remove the key', async () => {
      window.localStorage.setItem(LEGACY_VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify(['money', 'customer']));
      setup();

      await screen.findByText('NUM-ol_1');
      await waitFor(() => expect(screen.queryByRole('columnheader', { name: /Channel/ })).toBeNull());
      expect(screen.getByRole('columnheader', { name: /Customer/ })).toBeInTheDocument();
      expect(window.localStorage.getItem(LEGACY_VISIBLE_COLUMNS_STORAGE_KEY)).toBeNull();
    });

    it('should drop columns the list no longer has and still remove the key', async () => {
      window.localStorage.setItem(LEGACY_VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify(['retired', 'status']));
      setup();

      await screen.findByText('NUM-ol_1');
      await waitFor(() => expect(screen.queryByRole('columnheader', { name: /Customer/ })).toBeNull());
      expect(window.localStorage.getItem(LEGACY_VISIBLE_COLUMNS_STORAGE_KEY)).toBeNull();
    });

    it('should remove the key and leave a personal default view alone', async () => {
      window.localStorage.setItem(LEGACY_VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify(['status']));
      const mine = {
        id: 'sv-mine',
        pageKey: 'orders',
        name: 'My view',
        scope: 'personal',
        definition: { v: 1, query: '', sort: null, columns: ['customer', 'channel'], parts: {} },
        revision: 1,
        isDefault: true,
        ownerUserId: 'u1',
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      } as unknown as SavedView;
      setup({ savedViews: [mine] });

      await screen.findByText('NUM-ol_1');
      await waitFor(() => expect(params().get('view')).toBe('sv-mine'));
      expect(screen.getByRole('columnheader', { name: /Channel/ })).toBeInTheDocument();
      expect(window.localStorage.getItem(LEGACY_VISIBLE_COLUMNS_STORAGE_KEY)).toBeNull();
    });
  });

  describe('with the flag off', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_OL_ORDERS_SAVED_VIEWS_ENABLED', 'false');
    });

    it('should render the previous list: health tabs, the column control and no view in the address', async () => {
      setup();

      await screen.findByText('NUM-ol_1');
      await settle();
      expect(await screen.findByRole('tab', { name: /Needs attention/ })).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Views' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Columns & sort/ })).toBeNull();
      expect(screen.getByRole('button', { name: /^Columns/ })).toBeInTheDocument();
      expect(params().has('view')).toBe(false);
      expect(params().has('sort')).toBe(false);
    });

    it('should leave a stored column choice for the column control that owns it', async () => {
      window.localStorage.setItem(LEGACY_VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify(['money']));
      setup();

      await screen.findByText('NUM-ol_1');
      await waitFor(() => expect(screen.queryByRole('columnheader', { name: /Channel/ })).toBeNull());
      expect(window.localStorage.getItem(LEGACY_VISIBLE_COLUMNS_STORAGE_KEY)).not.toBeNull();
    });
  });
});
