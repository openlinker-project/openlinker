/**
 * OrdersListPage bulk actions (#3619, mockup M3 `bulk`)
 *
 * Selection is decoupled from dispatch: an already-dispatched order is
 * selectable for cancel, tag and "mark message read", while "Dispatch N" keeps
 * excluding it. Viewers see none of the buttons, only admins see Cancel, and
 * more than 100 selected disables the new actions with a reason.
 */
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import { OrdersListPage } from './orders-list-page';
import type { OrderRecord, PaginatedOrders } from '../../features/orders/api/orders.types';
import type { SessionUser } from '../../shared/auth/session.types';

vi.mock('../../features/demo', () => ({ captureDemoEvent: vi.fn() }));

function makeOrder(id: string, extra: Partial<OrderRecord> = {}): OrderRecord {
  return {
    internalOrderId: id,
    sourceConnectionId: 'conn_1',
    sourceEventId: null,
    orderSnapshot: { orderNumber: `NUM-${id}`, items: [], totals: { total: 10, currency: 'PLN' } },
    syncStatus: [],
    syncAttempts: [],
    recordStatus: 'ready',
    createdAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-01-15T10:00:00.000Z',
    ...extra,
  } as unknown as OrderRecord;
}

function paginated(items: OrderRecord[]): PaginatedOrders {
  return { items, total: items.length, limit: 20, offset: 0 };
}

const USER = (role: string, permissions: string[]): SessionUser => ({
  id: `u_${role}`,
  username: role,
  email: `${role}@example.com`,
  role,
  permissions: permissions as SessionUser['permissions'],
  analyticsConsent: true,
});

function renderPage(items: OrderRecord[], user?: SessionUser) {
  const api = createMockApiClient({
    orders: {
      list: vi.fn().mockResolvedValue(paginated(items)),
      listTags: vi.fn().mockResolvedValue([]),
    },
    connections: { list: vi.fn().mockResolvedValue([]) },
  });
  return renderWithProviders(<OrdersListPage />, {
    apiClient: api,
    sessionAdapter: createAuthenticatedSessionAdapter(user),
  });
}

beforeEach(() => {
  window.localStorage.removeItem('ol.orders-list.filters-open.v1');
});
afterEach(cleanup);

describe('OrdersListPage bulk actions (#3619)', () => {
  it('should let a dispatched order be selected for cancel while Dispatch excludes it', async () => {
    const user = userEvent.setup();
    renderPage([
      makeOrder('ol_ready'),
      makeOrder('ol_shipped', { fulfillmentState: 'dispatched' } as Partial<OrderRecord>),
    ]);

    await screen.findByText('NUM-ol_ready');
    await user.click(await screen.findByRole('checkbox', { name: 'Select ol_ready' }));
    const shipped = await screen.findByRole('checkbox', { name: 'Select ol_shipped' });
    expect(shipped).toBeEnabled();
    await user.click(shipped);

    expect(screen.getByTestId('orders-bulk-cancel')).toHaveTextContent('Cancel 2');
    expect(screen.getByTestId('orders-bulk-cancel')).toBeEnabled();
    expect(screen.getByTestId('orders-bulk-dispatch')).toHaveTextContent('Dispatch 1');
    expect(screen.getByTestId('orders-bulk-hint')).toHaveTextContent('Dispatch 1 of 2: 1 already shipped');
  });

  it('should disable Dispatch with a reason when only dispatched orders are selected', async () => {
    const user = userEvent.setup();
    renderPage([makeOrder('ol_shipped', { fulfillmentState: 'delivered' } as Partial<OrderRecord>)]);

    await user.click(await screen.findByRole('checkbox', { name: 'Select ol_shipped' }));

    expect(screen.getByTestId('orders-bulk-dispatch')).toBeDisabled();
    expect(screen.getByTestId('orders-bulk-cancel')).toBeEnabled();
  });

  it('should open the bulk cancel dialog from the Cancel button', async () => {
    const user = userEvent.setup();
    renderPage([makeOrder('ol_ready')]);

    await user.click(await screen.findByRole('checkbox', { name: 'Select ol_ready' }));
    await user.click(screen.getByTestId('orders-bulk-cancel'));

    expect(await screen.findByTestId('orders-bulk-cancel-dialog')).toBeInTheDocument();
  });

  it('should offer Mark message read only when a selected order has an unread note', async () => {
    const user = userEvent.setup();
    renderPage([
      makeOrder('ol_plain'),
      makeOrder('ol_note', { hasBuyerNote: true, buyerNoteState: 'present' } as Partial<OrderRecord>),
    ]);

    await user.click(await screen.findByRole('checkbox', { name: 'Select ol_plain' }));
    expect(screen.getByTestId('orders-bulk-read')).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'Select ol_note' }));
    expect(screen.getByTestId('orders-bulk-read')).toBeEnabled();
  });

  it('should hide Cancel from an operator and every bulk action from a viewer', async () => {
    const user = userEvent.setup();
    renderPage([makeOrder('ol_ready')], USER('operator', ['orders:read', 'orders:write']));

    await user.click(await screen.findByRole('checkbox', { name: 'Select ol_ready' }));
    expect(screen.getByTestId('orders-bulk-read')).toBeInTheDocument();
    expect(screen.getByTestId('orders-bulk-tags')).toBeInTheDocument();
    expect(screen.queryByTestId('orders-bulk-cancel')).toBeNull();

    cleanup();
    renderPage([makeOrder('ol_ready')], USER('viewer', ['orders:read']));
    await screen.findByText('NUM-ol_ready');
    expect(screen.queryByRole('checkbox', { name: 'Select ol_ready' })).toBeNull();
    expect(screen.queryByTestId('orders-bulk-cancel')).toBeNull();
    expect(screen.queryByTestId('orders-bulk-tags')).toBeNull();
    expect(screen.queryByTestId('orders-bulk-read')).toBeNull();
  });

  it('should cap the selection at 100 with a reason on the remaining checkboxes', async () => {
    const user = userEvent.setup();
    const orders = Array.from({ length: 101 }, (_, i) => makeOrder(`ol_${String(i).padStart(3, '0')}`));
    renderPage(orders);

    await screen.findByText('NUM-ol_000');
    await user.click(await screen.findByRole('checkbox', { name: 'Select all visible orders' }));

    expect(screen.getByTestId('orders-bulk-cancel')).toHaveTextContent('Cancel 100');
    expect(screen.getByRole('checkbox', { name: 'Select ol_100' })).toBeDisabled();
  });
});
