/**
 * `OrderHoldPanel` unit tests (#2342).
 *
 * Two acceptance criteria live here, and both are about who may act:
 * a read-only role sees the badge and the history and NO write action, and an
 * ordinary operator — who holds `orders:write` but is refused by the
 * `@Roles('admin')` routes — is not shown a button that would 403.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderHoldPanel } from './order-hold-panel';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { SessionUser } from '../../../shared/auth/session.types';
import type { OrderHold } from '../api/orders.types';

const ORDER_ID = 'ol_order_1';

const ADMIN: SessionUser = {
  id: 'user_1',
  username: 'admin',
  email: 'admin@example.com',
  role: 'admin',
  permissions: ['orders:read', 'orders:write'],
};

/** Holds `orders:write` — and is still refused by the admin-only hold routes. */
const OPERATOR: SessionUser = {
  id: 'user_2',
  username: 'operator',
  email: 'operator@example.com',
  role: 'operator',
  permissions: ['orders:read', 'orders:write'],
};

const VIEWER: SessionUser = {
  id: 'user_3',
  username: 'viewer',
  email: 'viewer@example.com',
  role: 'viewer',
  permissions: ['orders:read'],
};

function hold(overrides: Partial<OrderHold> = {}): OrderHold {
  return {
    id: 'hold_1',
    internalOrderId: ORDER_ID,
    reason: 'stock-shortfall',
    note: null,
    placedByUserId: 'user_1',
    placedByService: null,
    placedAt: '2026-08-20T10:00:00.000Z',
    releasedAt: null,
    releasedByUserId: null,
    releaseNote: null,
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
    ...overrides,
  };
}

function renderPanel(
  props: Partial<React.ComponentProps<typeof OrderHoldPanel>> = {},
  opts: {
    user?: SessionUser;
    demoMode?: boolean;
    releaseHold?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const api = createMockApiClient({
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: opts.demoMode ?? false }) },
    ...(opts.releaseHold ? { orders: { releaseHold: opts.releaseHold } as never } : {}),
  });

  return renderWithProviders(
    <OrderHoldPanel
      internalOrderId={ORDER_ID}
      activeHold={null}
      holdHistory={[]}
      {...props}
    />,
    { apiClient: api, sessionAdapter: createAuthenticatedSessionAdapter(opts.user ?? ADMIN) },
  );
}

afterEach(cleanup);

describe('OrderHoldPanel (#2342)', () => {
  it('should offer "Put on hold" for an order that is not held', async () => {
    renderPanel();
    expect(screen.getByText('Not on hold.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Put on hold' })).toBeInTheDocument();
  });

  it('should show the open hold and offer "Release hold"', async () => {
    renderPanel({ activeHold: hold({ note: 'Waiting on the supplier' }) });
    expect(screen.getByText(/On hold — Stock shortfall/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting on the supplier/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Release hold' })).toBeInTheDocument();
  });

  it('should show a read-only role the hold and history with NO write action', () => {
    renderPanel(
      {
        activeHold: hold(),
        holdHistory: [hold(), hold({ id: 'hold_0', releasedAt: '2026-08-19T09:00:00.000Z' })],
      },
      { user: VIEWER },
    );

    expect(screen.getByText(/On hold — Stock shortfall/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release hold' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Put on hold' })).not.toBeInTheDocument();
  });

  it('should hide the action from an operator, whose `orders:write` the routes still refuse', () => {
    // The routes are `@Roles('admin')` while `ROLE_PERMISSIONS.operator` grants
    // `orders:write` — gating on the permission alone renders a button that 403s.
    renderPanel({ activeHold: hold() }, { user: OPERATOR });

    expect(screen.getByText(/On hold — Stock shortfall/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release hold' })).not.toBeInTheDocument();
  });

  it('should render the released history with its actor and note', () => {
    renderPanel({
      activeHold: null,
      holdHistory: [
        hold({
          id: 'hold_0',
          reason: 'operator',
          releasedAt: '2026-08-19T09:00:00.000Z',
          releasedByUserId: 'user_9',
          releaseNote: 'Buyer confirmed',
        }),
      ],
    });

    expect(screen.getByText(/Held by operator/)).toBeInTheDocument();
    expect(screen.getByText(/Buyer confirmed/)).toBeInTheDocument();
    expect(screen.getByText('user_9')).toBeInTheDocument();
  });

  it('should label a reason this build does not recognise with its raw value', () => {
    // Through the shared `holdReasonLabel`, which every hold surface now calls —
    // it was exported, spec'd and reachable only from its own test while three
    // production call sites hand-copied the logic.
    renderPanel({ activeHold: hold({ reason: 'reason-from-a-newer-build' as never }) });
    expect(screen.getByText(/On hold — reason-from-a-newer-build/)).toBeInTheDocument();
  });

  it('should not carry a failed-resume alert onto a DIFFERENT order', async () => {
    // The leak: `resumeFailure` was cleared only by a release, and navigating to
    // a CACHED next order re-renders without remounting (the detail page
    // early-returns a skeleton on `isLoading` only) — so the operator was told
    // "this order did not start moving again" about an order never held.
    const target = hold();
    const releaseHold = vi.fn().mockResolvedValue({
      hold: { ...target, releasedAt: '2026-08-21T09:00:00.000Z', releasedByUserId: 'user_1' },
      provisioningResume: { status: 'failed', jobId: null, reason: 'enqueue-failed' },
    });
    const { rerender } = renderPanel({ activeHold: target }, { releaseHold });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Release hold' }));
    await user.click(await screen.findByRole('button', { name: 'Release hold' }));

    expect(await screen.findByText(/did not start moving again/i)).toBeInTheDocument();

    rerender(
      <OrderHoldPanel
        internalOrderId="ol_order_2_never_held"
        activeHold={null}
        holdHistory={[]}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText(/did not start moving again/i)).not.toBeInTheDocument();
    });
  });

  it('should tolerate a payload carrying no hold fields at all', () => {
    // A record from an API predating #2341: `undefined` and `null` mean the same.
    renderPanel({ activeHold: undefined, holdHistory: undefined });
    expect(screen.getByText('Not on hold.')).toBeInTheDocument();
  });
});
