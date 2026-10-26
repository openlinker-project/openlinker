/**
 * `OrderEditAction` unit tests (#3544).
 *
 * Who may act, and for which orders. Every edit route is `@Roles('admin')` while
 * the operator role holds `orders:write`, so the permission alone would render a
 * button that 403s.
 */
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderEditAction, type OrderEditActionProps } from './order-edit-action';
import type { SessionUser } from '../../../shared/auth/session.types';
import { parseOrderSnapshot } from '../api/order-snapshot.schema';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';

const ADMIN: SessionUser = {
  id: 'user_1',
  username: 'admin',
  email: 'admin@example.com',
  role: 'admin',
  permissions: ['orders:read', 'orders:write'],
};
const OPERATOR: SessionUser = { ...ADMIN, id: 'user_2', username: 'operator', role: 'operator' };
const VIEWER: SessionUser = {
  ...ADMIN,
  id: 'user_3',
  username: 'viewer',
  role: 'viewer',
  permissions: ['orders:read'],
};

const snapshot = parseOrderSnapshot({
  orderNumber: 'ALG-1',
  items: [{ id: 'line_a', name: 'Mug', quantity: 2, price: 10 }],
  totals: { subtotal: 20, tax: 0, shipping: 0, total: 20, currency: 'PLN' },
});

function renderAction(props: Partial<OrderEditActionProps> = {}, user: SessionUser = ADMIN) {
  const api = createMockApiClient({
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false }) },
  });
  return renderWithProviders(
    <OrderEditAction
      internalOrderId="ol_order_1"
      orderNumber="ALG-1"
      sourceName="Allegro"
      snapshot={snapshot}
      edits={null}
      packed={false}
      acceptedWork={false}
      terminal={false}
      amending={false}
      onSaved={vi.fn()}
      {...props}
    />,
    { apiClient: api, sessionAdapter: createAuthenticatedSessionAdapter(user) },
  );
}

afterEach(cleanup);

describe('OrderEditAction (#3544)', () => {
  it('should open the edit dialog for an admin', async () => {
    renderAction();
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('order-edit-button'));

    expect(await screen.findByText('Edit order ALG-1')).toBeInTheDocument();
  });

  it('should be hidden from an operator, whose `orders:write` the admin-only routes still refuse', () => {
    renderAction({}, OPERATOR);
    expect(screen.queryByTestId('order-edit-button')).not.toBeInTheDocument();
  });

  it('should be hidden from a read-only role', () => {
    renderAction({}, VIEWER);
    expect(screen.queryByTestId('order-edit-button')).not.toBeInTheDocument();
  });

  it('should be hidden for an order in a terminal state', () => {
    renderAction({ terminal: true });
    expect(screen.queryByTestId('order-edit-button')).not.toBeInTheDocument();
  });

  it('should be disabled while a cancellation is waiting for the channel', async () => {
    renderAction({ amending: true });
    expect(await screen.findByTestId('order-edit-button')).toBeDisabled();
  });

  it('should open straight onto the blocked layout for a packed order', async () => {
    renderAction({ packed: true });
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('order-edit-button'));

    expect(await screen.findByTestId('order-edit-blocked')).toHaveTextContent(/already packed/);
  });
});
