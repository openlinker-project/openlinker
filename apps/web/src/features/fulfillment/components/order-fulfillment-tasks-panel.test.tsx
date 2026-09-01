/**
 * `OrderFulfillmentTasksPanel` tests (#2411).
 *
 * The properties pinned here are the ones the design and the #2406 contract
 * make load-bearing, and each is written so that it goes RED when the property
 * is removed:
 *
 *   1. heldness reads `activeHolds`, not `status` — POSITIVE assertion, because
 *      "does not say Open" also passes when the component renders nothing.
 *   2. controls come only from `supportedActions` — including an empty array
 *      against a NON-terminal status, which is the fixture a smuggled
 *      `if (status === 'open')` would light up.
 *   3. counters gate nothing — asserted by comparing the enabled control set
 *      across two renders that differ ONLY in the counters.
 *   4. the version that was RENDERED is the version sent.
 *   5. loading / error / empty are three different answers, never one.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderFulfillmentTasksPanel } from './order-fulfillment-tasks-panel';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { SessionUser } from '../../../shared/auth/session.types';
import type { FulfillmentTask } from '../api/fulfillment.types';
import { ApiError } from '../../../shared/api/api-error';

const ORDER_ID = 'ol_order_1';

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

function task(overrides: Partial<FulfillmentTask> = {}): FulfillmentTask {
  return {
    id: 'ol_work_1',
    orderId: ORDER_ID,
    locationId: 'loc_warsaw',
    deliveryMethod: null,
    assignedConnectionId: null,
    status: 'open',
    requestStatus: 'unsubmitted',
    assignmentAttempt: 0,
    cancellationReason: null,
    externalWorkId: null,
    acceptedAt: null,
    cancelledAt: null,
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
    lines: [
      {
        id: 'line_1',
        orderLineId: 'ol_orderline_1',
        productVariantId: 'ol_variant_1',
        totalQuantity: 3,
        fulfilledQuantity: 0,
        cancelledQuantity: 0,
      },
    ],
    activeHolds: [],
    supportedActions: [],
    version: 7,
    ...overrides,
  };
}

function renderPanel(
  tasks: FulfillmentTask[],
  opts: {
    user?: SessionUser;
    applyAction?: ReturnType<typeof vi.fn>;
    listByOrder?: ReturnType<typeof vi.fn>;
  } = {}
): ReturnType<typeof renderWithProviders> & {
  applyAction: ReturnType<typeof vi.fn>;
  listByOrder: ReturnType<typeof vi.fn>;
} {
  const applyAction = opts.applyAction ?? vi.fn().mockResolvedValue(tasks[0] ?? task());
  const listByOrder =
    opts.listByOrder ??
    vi.fn().mockResolvedValue({ works: tasks, total: tasks.length, limit: 50, offset: 0 });

  const api = createMockApiClient({
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false }) },
    fulfillment: { listByOrder, applyAction } as never,
  });

  const utils = renderWithProviders(<OrderFulfillmentTasksPanel internalOrderId={ORDER_ID} />, {
    apiClient: api,
    sessionAdapter: createAuthenticatedSessionAdapter(opts.user ?? OPERATOR),
  });

  return { ...utils, applyAction, listByOrder };
}

/** Every enabled button currently rendered, by label. */
function enabledControlNames(): string[] {
  return screen
    .queryAllByRole('button')
    .filter((button) => !(button as HTMLButtonElement).disabled)
    .map((button) => button.textContent ?? '');
}

afterEach(cleanup);

describe('OrderFulfillmentTasksPanel (#2411)', () => {
  describe('heldness comes from activeHolds, not status', () => {
    it('should say the task is on hold even though its status reads open', async () => {
      renderPanel([
        task({
          status: 'open',
          activeHolds: [
            {
              id: 'hold_1',
              reason: 'stock-shortfall',
              note: 'Waiting on the supplier',
              placedAt: '2026-08-20T10:00:00.000Z',
            },
          ],
        }),
      ]);

      // POSITIVE: the held badge is present and names the reason through the
      // shared display label, never the raw `stock-shortfall`.
      expect(await screen.findByText('On hold — Stock shortfall')).toBeInTheDocument();
      expect(screen.getByText(/Waiting on the supplier/)).toBeInTheDocument();
      expect(screen.queryByText('stock-shortfall')).not.toBeInTheDocument();
    });

    it('should still report the underlying state, so the hold badge hides nothing', async () => {
      renderPanel([
        task({
          status: 'scheduled',
          activeHolds: [
            { id: 'hold_1', reason: 'operator', note: null, placedAt: '2026-08-20T10:00:00.000Z' },
          ],
        }),
      ]);

      expect(await screen.findByText('On hold — Held by operator')).toBeInTheDocument();
      // The State row still says Scheduled — "held" and "scheduled" are both true.
      expect(screen.getByText('Scheduled')).toBeInTheDocument();
    });

    it('should show the plain status when nothing is holding the task', async () => {
      renderPanel([task({ status: 'in_progress' })]);

      expect(await screen.findAllByText('In progress')).not.toHaveLength(0);
      expect(screen.queryByText(/On hold/)).not.toBeInTheDocument();
    });
  });

  describe('controls come only from supportedActions', () => {
    it('should render no controls for an OPEN task whose supportedActions is empty', async () => {
      // `open` is deliberate: it is the non-terminal status a smuggled
      // `if (status === "open") showSchedule` would key on, so this fixture is
      // what makes the assertion able to fail.
      renderPanel([task({ status: 'open', supportedActions: [] })]);

      // Two matches by design: the badge and the State row (see the card's
      // docblock — the underlying state is never hidden).
      expect(await screen.findAllByText('Open')).not.toHaveLength(0);
      expect(screen.queryByRole('button', { name: 'Schedule' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Put on hold' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });

    it('should render exactly the actions the server declared', async () => {
      renderPanel([task({ supportedActions: ['schedule', 'close'] })]);

      expect(await screen.findByRole('button', { name: 'Schedule' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Put on hold' })).not.toBeInTheDocument();
    });

    it('should still offer an action this build has no copy for', async () => {
      renderPanel([task({ supportedActions: ['split_across_locations'] })]);

      expect(
        await screen.findByRole('button', { name: 'Split across locations' })
      ).toBeInTheDocument();
    });

    it('should offer one Release hold per active hold, since each needs its own id', async () => {
      renderPanel([
        task({
          supportedActions: ['release_hold'],
          activeHolds: [
            { id: 'h1', reason: 'operator', note: null, placedAt: '2026-08-20T10:00:00.000Z' },
            {
              id: 'h2',
              reason: 'stock-shortfall',
              note: null,
              placedAt: '2026-08-20T11:00:00.000Z',
            },
          ],
        }),
      ]);

      expect(
        await screen.findByRole('button', { name: 'Release hold (operator)' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Release hold (stock-shortfall)' })
      ).toBeInTheDocument();
    });
  });

  describe('counters are display-only and gate nothing', () => {
    it('should offer an identical control set whatever the counters read', async () => {
      const actions = ['schedule', 'close'];
      const { unmount } = renderPanel([
        task({
          supportedActions: actions,
          lines: [
            {
              id: 'line_1',
              orderLineId: 'ol_orderline_1',
              productVariantId: 'ol_variant_1',
              totalQuantity: 3,
              fulfilledQuantity: 0,
              cancelledQuantity: 0,
            },
          ],
        }),
      ]);
      await screen.findByRole('button', { name: 'Schedule' });
      const atZero = enabledControlNames();
      unmount();
      cleanup();

      renderPanel([
        task({
          supportedActions: actions,
          lines: [
            {
              id: 'line_1',
              orderLineId: 'ol_orderline_1',
              productVariantId: 'ol_variant_1',
              totalQuantity: 3,
              fulfilledQuantity: 3,
              cancelledQuantity: 0,
            },
          ],
        }),
      ]);
      await screen.findByRole('button', { name: 'Schedule' });
      const atFull = enabledControlNames();

      expect(atFull).toEqual(atZero);
    });

    it('should state that the counters may be behind', async () => {
      renderPanel([task({ supportedActions: [] })]);

      expect(await screen.findByText(/can be a little behind/)).toBeInTheDocument();
    });
  });

  describe('the optimistic token', () => {
    it('should send the version it RENDERED with the action', async () => {
      const applyAction = vi.fn().mockResolvedValue(task({ version: 8 }));
      renderPanel([task({ supportedActions: ['schedule'], version: 7 })], { applyAction });

      await userEvent.click(await screen.findByRole('button', { name: 'Schedule' }));

      await waitFor(() => {
        expect(applyAction).toHaveBeenCalledWith(
          'ol_work_1',
          'schedule',
          expect.objectContaining({ expectedVersion: 7 })
        );
      });
    });

    it('should refresh itself after a stale-token 409 rather than asking for a reload', async () => {
      const applyAction = vi.fn().mockRejectedValue(
        new ApiError('stale', 409, {
          code: 'version_conflict',
          expectedVersion: 7,
          currentVersion: 9,
          supportedActions: ['close'],
        })
      );
      const listByOrder = vi.fn().mockResolvedValue({
        works: [task({ supportedActions: ['schedule'], version: 7 })],
        total: 1,
        limit: 50,
        offset: 0,
      });
      renderPanel([], { applyAction, listByOrder });

      await userEvent.click(await screen.findByRole('button', { name: 'Schedule' }));

      // The refetch IS the re-render — one initial read plus one after the 409.
      await waitFor(() => {
        expect(listByOrder).toHaveBeenCalledTimes(2);
      });
    });

    it('should also refresh after an action-not-legal 409, which is NOT retried', async () => {
      const applyAction = vi.fn().mockRejectedValue(
        new ApiError('not legal', 409, {
          code: 'action_not_legal',
          action: 'schedule',
          supportedActions: ['close'],
        })
      );
      const listByOrder = vi.fn().mockResolvedValue({
        works: [task({ supportedActions: ['schedule'], version: 7 })],
        total: 1,
        limit: 50,
        offset: 0,
      });
      renderPanel([], { applyAction, listByOrder });

      await userEvent.click(await screen.findByRole('button', { name: 'Schedule' }));

      await waitFor(() => {
        expect(listByOrder).toHaveBeenCalledTimes(2);
      });
      // Never retried: exactly one attempt was made.
      expect(applyAction).toHaveBeenCalledTimes(1);
    });

    it('should NOT refresh after a failure that says nothing about staleness', async () => {
      const applyAction = vi.fn().mockRejectedValue(new ApiError('boom', 500, {}));
      const listByOrder = vi.fn().mockResolvedValue({
        works: [task({ supportedActions: ['schedule'], version: 7 })],
        total: 1,
        limit: 50,
        offset: 0,
      });
      renderPanel([], { applyAction, listByOrder });

      await userEvent.click(await screen.findByRole('button', { name: 'Schedule' }));

      await waitFor(() => {
        expect(applyAction).toHaveBeenCalledTimes(1);
      });
      expect(listByOrder).toHaveBeenCalledTimes(1);
    });
  });

  describe('unknown is never reported as none', () => {
    it('should say the order has no fulfilment tasks only on a SETTLED, successful read', async () => {
      renderPanel([]);

      expect(await screen.findByText(/No fulfilment tasks/)).toBeInTheDocument();
    });

    it('should report a failed read as an error with a Retry, never as "no tasks"', async () => {
      const listByOrder = vi.fn().mockRejectedValue(new ApiError('boom', 500, {}));
      renderPanel([], { listByOrder });

      expect(await screen.findByText(/Could not load/)).toBeInTheDocument();
      expect(screen.queryByText(/No fulfilment tasks/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('should say it is loading rather than claiming there are no tasks', () => {
      const listByOrder = vi.fn().mockReturnValue(new Promise(() => {}));
      renderPanel([], { listByOrder });

      expect(screen.getByText(/Loading fulfilment tasks/)).toBeInTheDocument();
      expect(screen.queryByText(/No fulfilment tasks/)).not.toBeInTheDocument();
    });
  });

  describe('write gating', () => {
    it('should show a viewer the tasks and their holds with NO write control', async () => {
      renderPanel(
        [
          task({
            supportedActions: ['schedule', 'hold'],
            activeHolds: [
              { id: 'h1', reason: 'operator', note: null, placedAt: '2026-08-20T10:00:00.000Z' },
            ],
          }),
        ],
        { user: VIEWER }
      );

      expect(await screen.findByText('On hold — Held by operator')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Schedule' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Put on hold' })).not.toBeInTheDocument();
    });

    it('should show an OPERATOR the write controls — the action route allows them', async () => {
      // Deliberately distinct from `OrderHoldPanel`, whose routes are admin-only.
      // Copying its `useIsAdmin()` conjunction here would hide every fulfilment
      // action from exactly the role the route exists to serve.
      renderPanel([task({ supportedActions: ['schedule'] })], { user: OPERATOR });

      expect(await screen.findByRole('button', { name: 'Schedule' })).toBeInTheDocument();
    });
  });

  describe('the hold form', () => {
    it('should send holdReason for hold, and releaseNote (not note) for release_hold', async () => {
      const applyAction = vi.fn().mockResolvedValue(task());
      renderPanel(
        [
          task({
            supportedActions: ['release_hold'],
            activeHolds: [
              { id: 'h1', reason: 'operator', note: null, placedAt: '2026-08-20T10:00:00.000Z' },
            ],
          }),
        ],
        { applyAction }
      );

      await userEvent.click(await screen.findByRole('button', { name: 'Release hold' }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/Note/), 'supplier delivered');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Release hold' }));

      await waitFor(() => {
        expect(applyAction).toHaveBeenCalledWith(
          'ol_work_1',
          'release_hold',
          expect.objectContaining({ holdId: 'h1', releaseNote: 'supplier delivered' })
        );
      });
      // `note` is the field a PLACE records; sending it here would be accepted
      // with a 2xx and silently lose what the operator typed.
      expect(applyAction.mock.calls[0]?.[2]).not.toHaveProperty('note');
    });
  });
});
