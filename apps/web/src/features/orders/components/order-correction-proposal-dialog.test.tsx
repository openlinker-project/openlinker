/**
 * `OrderCorrectionProposalDialog` role and demo gating tests (#3541, B-22).
 *
 * The confirm route is `@Roles('admin')` while the operator role holds
 * `orders:write`, so the permission alone would render a button that 403s.
 */
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderCorrectionProposalDialog } from './order-correction-proposal-dialog';
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

function renderDialog(user: SessionUser, demoMode = false) {
  const confirmOrderChange = vi.fn().mockResolvedValue({});
  const api = createMockApiClient({
    orders: { confirmOrderChange },
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode }) },
  });
  renderWithProviders(
    <OrderCorrectionProposalDialog
      open
      onOpenChange={vi.fn()}
      internalOrderId="ol_order_1"
      proposal={{
        changeId: 'change_1',
        invoiceRecordId: 'inv_1',
        documentNumber: 'FV/1',
        currency: 'PLN',
        lines: [{ originalLineNumber: 1, name: 'Kubek', previousQuantity: 1, newQuantity: 0 }],
      }}
      onConfirmed={vi.fn()}
    />,
    { apiClient: api, sessionAdapter: createAuthenticatedSessionAdapter(user) },
  );
  return { confirmOrderChange };
}

afterEach(cleanup);

describe('OrderCorrectionProposalDialog gating (B-22)', () => {
  it('should offer Confirm correction to an admin with orders:write (B-22)', async () => {
    renderDialog(ADMIN);
    expect(await screen.findByTestId('order-correction-confirm')).toBeEnabled();
  });

  it.each([
    ['operator', OPERATOR],
    ['viewer', VIEWER],
  ])('should show the proposal without a confirm button to a %s (B-22)', async (_name, user) => {
    renderDialog(user);
    expect(await screen.findByTestId('order-correction-lines')).toBeInTheDocument();
    expect(screen.queryByTestId('order-correction-confirm')).not.toBeInTheDocument();
  });

  it('should show the confirm button locked in demo read-only mode and send nothing (B-22)', async () => {
    const { confirmOrderChange } = renderDialog(VIEWER, true);
    const button = await screen.findByTestId('order-correction-confirm');
    expect(button).toBeDisabled();

    await userEvent.setup().click(button);

    expect(confirmOrderChange).not.toHaveBeenCalled();
  });
});
