import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderConfirmRefundAction } from './order-confirm-refund-action';
import type { SessionUser } from '../../../shared/auth/session.types';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';

const OPERATOR: SessionUser = {
  id: 'user_2',
  username: 'operator',
  email: 'operator@example.com',
  role: 'operator',
  permissions: ['orders:read', 'orders:write'],
};
const VIEWER: SessionUser = { ...OPERATOR, id: 'user_3', role: 'viewer', permissions: ['orders:read'] };

function renderAction(visible: boolean, user: SessionUser) {
  const api = createMockApiClient({
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false }) },
  });
  return renderWithProviders(
    <OrderConfirmRefundAction
      internalOrderId="ol_order_1"
      currency="PLN"
      orderTotal="10.00"
      visible={visible}
    />,
    { apiClient: api, sessionAdapter: createAuthenticatedSessionAdapter(user) },
  );
}

afterEach(cleanup);

describe('OrderConfirmRefundAction (#3541)', () => {
  it('should be offered to an operator once the order is cancelled', async () => {
    renderAction(true, OPERATOR);
    expect(await screen.findByTestId('order-confirm-refund-button')).toBeEnabled();
  });

  it('should be hidden while there is no cancel to refund', () => {
    renderAction(false, OPERATOR);
    expect(screen.queryByTestId('order-confirm-refund-button')).not.toBeInTheDocument();
  });

  it('should be hidden from a read-only role', () => {
    renderAction(true, VIEWER);
    expect(screen.queryByTestId('order-confirm-refund-button')).not.toBeInTheDocument();
  });
});
