/**
 * `OrderCancelAction` unit tests (#3541).
 *
 * Who may act, and for which orders. The routes are `@Roles('admin')` while the
 * operator role holds `orders:write`, so the permission alone would render a
 * button that 403s.
 */
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderCancelAction, type OrderCancelActionProps } from './order-cancel-action';
import type { SessionUser } from '../../../shared/auth/session.types';
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

function renderAction(
  props: Partial<OrderCancelActionProps> = {},
  user: SessionUser = ADMIN,
) {
  const api = createMockApiClient({
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false }) },
  });
  return renderWithProviders(
    <OrderCancelAction
      internalOrderId="ol_order_1"
      orderNumber="ALG-1"
      sourceName="Allegro"
      unitCount={2}
      totalLabel="10.00 PLN"
      invoiced={false}
      acceptedWork={false}
      terminal={false}
      amending={false}
      onResult={vi.fn()}
      {...props}
    />,
    { apiClient: api, sessionAdapter: createAuthenticatedSessionAdapter(user) },
  );
}

afterEach(cleanup);

describe('OrderCancelAction (#3541)', () => {
  it('should open the confirmation dialog before anything is sent', async () => {
    renderAction();
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('order-cancel-button'));

    expect(await screen.findByText('Cancel order ALG-1?')).toBeInTheDocument();
  });

  it('should be hidden from an operator, whose `orders:write` the admin-only route still refuses', () => {
    renderAction({}, OPERATOR);
    expect(screen.queryByTestId('order-cancel-button')).not.toBeInTheDocument();
  });

  it('should be hidden from a read-only role', () => {
    renderAction({}, VIEWER);
    expect(screen.queryByTestId('order-cancel-button')).not.toBeInTheDocument();
  });

  it('should be hidden for an order in a terminal state', () => {
    renderAction({ terminal: true });
    expect(screen.queryByTestId('order-cancel-button')).not.toBeInTheDocument();
  });

  it('should be disabled while a change is already waiting for the channel', async () => {
    renderAction({ amending: true });
    expect(await screen.findByTestId('order-cancel-button')).toBeDisabled();
  });
});
