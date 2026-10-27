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

function renderPage(items: OrderRecord[], user?: SessionUser, demoMode = false) {
  const bulkCancelOrders = vi.fn();
  const bulkMarkBuyerNoteRead = vi.fn();
  const api = createMockApiClient({
    orders: {
      list: vi.fn().mockResolvedValue(paginated(items)),
      listTags: vi.fn().mockResolvedValue([]),
      bulkCancelOrders,
      bulkMarkBuyerNoteRead,
    },
    connections: { list: vi.fn().mockResolvedValue([]) },
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode }) },
  });
  renderWithProviders(<OrdersListPage />, {
    apiClient: api,
    sessionAdapter: createAuthenticatedSessionAdapter(user),
  });
  return { bulkCancelOrders, bulkMarkBuyerNoteRead };
}

beforeEach(() => {
  window.localStorage.removeItem('ol.orders-list.filters-open.v1');
});
afterEach(cleanup);

describe('OrdersListPage bulk actions (#3619)', () => {
  it('should clear the selection when the sort changes so hidden rows are not acted on (B-26)', async () => {
    const user = userEvent.setup();
    renderPage([makeOrder('ol_ready')]);

    await user.click(await screen.findByRole('checkbox', { name: 'Select ol_ready' }));
    expect(screen.getByTestId('orders-bulk-cancel')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Customer, sort' }));

    expect(await screen.findByRole('checkbox', { name: 'Select ol_ready' })).not.toBeChecked();
    expect(screen.queryByTestId('orders-bulk-cancel')).toBeNull();
  });

  it('should remove the bulk bar when a sort change leaves nothing selected (B-6, B-18)', async () => {
    const user = userEvent.setup();
    renderPage([makeOrder('ol_ready')]);

    await user.click(await screen.findByRole('checkbox', { name: 'Select ol_ready' }));
    expect(screen.getByTestId('orders-bulk-bar')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Customer, sort' }));

    await screen.findByRole('checkbox', { name: 'Select ol_ready' });
    expect(screen.queryByTestId('orders-bulk-bar')).toBeNull();
  });

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

  it('should show the bulk actions locked, with no request sent, to a demo read-only viewer', async () => {
    const user = userEvent.setup();
    const { bulkCancelOrders, bulkMarkBuyerNoteRead } = renderPage(
      [makeOrder('ol_note', { hasBuyerNote: true, buyerNoteState: 'present' } as Partial<OrderRecord>)],
      USER('viewer', ['orders:read']),
      true,
    );

    await user.click(await screen.findByRole('checkbox', { name: 'Select ol_note' }));

    expect(screen.getByTestId('orders-bulk-tags')).toBeDisabled();
    expect(screen.getByTestId('orders-bulk-read')).toBeDisabled();
    expect(screen.getByTestId('orders-bulk-cancel')).toBeDisabled();

    await user.click(screen.getByTestId('orders-bulk-read'));
    expect(screen.queryByTestId('orders-bulk-read-dialog')).toBeNull();
    await user.click(screen.getByTestId('orders-bulk-cancel'));
    expect(bulkCancelOrders).not.toHaveBeenCalled();
    expect(bulkMarkBuyerNoteRead).not.toHaveBeenCalled();
  });

  it('should show bulk Cancel locked to a demo viewer and send no request on click (B-5)', async () => {
    const user = userEvent.setup();
    const { bulkCancelOrders } = renderPage(
      [makeOrder('ol_a')],
      USER('viewer', ['orders:read']),
      true,
    );

    await user.click(await screen.findByRole('checkbox', { name: 'Select ol_a' }));
    const cancel = screen.getByTestId('orders-bulk-cancel');
    expect(cancel).toBeDisabled();
    await user.click(cancel);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bulkCancelOrders).not.toHaveBeenCalled();
  });
});
