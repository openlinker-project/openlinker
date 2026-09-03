/**
 * `OrderPackedControl` unit tests (#2288).
 *
 * The four states the acceptance criteria name are all reachable here without
 * mounting the whole detail page: unpacked → mark, packed → attribution + undo,
 * viewer → no affordance at all, demo viewer → visible but locked.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderPackedControl } from './order-packed-control';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { SessionUser } from '../../../shared/auth/session.types';

const ORDER_ID = 'ol_order_1';
const PACKED_AT = '2026-04-20T10:00:00.000Z';

/** A viewer: authenticated, but without `orders:write`. */
const VIEWER: SessionUser = {
  id: 'user_2',
  username: 'viewer',
  email: 'viewer@example.com',
  role: 'viewer',
  permissions: ['orders:read'],
  analyticsConsent: true,
};

function renderControl(
  props: Partial<React.ComponentProps<typeof OrderPackedControl>> = {},
  opts: { user?: SessionUser; demoMode?: boolean } = {},
) {
  const orders = {
    markPacked: vi.fn().mockResolvedValue({ internalOrderId: ORDER_ID, packedAt: PACKED_AT }),
    unmarkPacked: vi.fn().mockResolvedValue({ internalOrderId: ORDER_ID, packedAt: null }),
  };
  const api = createMockApiClient({
    orders,
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: opts.demoMode ?? false }) },
  });

  renderWithProviders(
    <OrderPackedControl
      internalOrderId={ORDER_ID}
      packedAt={null}
      packedByUserId={null}
      {...props}
    />,
    {
      apiClient: api,
      sessionAdapter: createAuthenticatedSessionAdapter(opts.user),
    },
  );

  return orders;
}

afterEach(cleanup);

describe('OrderPackedControl (#2288)', () => {
  it('offers "Mark packed" for an unpacked order and calls the write', async () => {
    const orders = renderControl();
    const user = userEvent.setup();

    expect(screen.getByText('Not packed yet.')).toBeInTheDocument();
    const button = await screen.findByRole('button', { name: 'Mark packed' });
    await user.click(button);

    await waitFor(() => {
      expect(orders.markPacked).toHaveBeenCalledWith(ORDER_ID);
    });
    expect(orders.unmarkPacked).not.toHaveBeenCalled();
  });

  it('shows the attribution and an Undo for a packed order', async () => {
    const orders = renderControl({ packedAt: PACKED_AT, packedByUserId: 'user_7' });
    const user = userEvent.setup();

    expect(screen.getByText('user_7')).toBeInTheDocument();
    const undo = await screen.findByRole('button', { name: 'Undo' });
    await user.click(undo);

    await waitFor(() => {
      expect(orders.unmarkPacked).toHaveBeenCalledWith(ORDER_ID);
    });
    expect(orders.markPacked).not.toHaveBeenCalled();
  });

  it('hides the affordance from a viewer but still states the fact', async () => {
    renderControl({ packedAt: PACKED_AT, packedByUserId: 'user_7' }, { user: VIEWER });

    // The packed FACT is read-only information — a viewer sees it.
    expect(screen.getByText('user_7')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  it('renders the affordance visible-but-disabled for a demo viewer', async () => {
    renderControl({}, { user: VIEWER, demoMode: true });

    // A demo visitor should SEE that the action exists — the #1615 treatment
    // the orders list already applies to its per-row Retry.
    const button = await screen.findByRole('button', { name: 'Mark packed' });
    expect(button).toBeDisabled();
  });
});
