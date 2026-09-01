/**
 * `FulfillmentWorklistPage` — AC2 (the 409 path) and AC3 part 1 (the two
 * surfaces agree) (#2410).
 *
 * ## What is deliberately NOT re-asserted here
 *
 * `readFulfillmentConflict` classifies both coded 409s and has its own spec
 * (#2411). Re-testing that pure function over an in-memory object from a second
 * file would pass with this entire body reverted, which is the vacuous shape
 * this programme keeps shipping. What is NOT covered anywhere else is the
 * WORKLIST's own behaviour on a 409, so that is what is written below.
 *
 * ## The assertion that actually fails when the handler is deleted
 *
 * `list` called EXACTLY twice. React Query settles either way, so an await-only
 * test passes with the conflict branch removed — the call count is the only
 * thing that observes the refresh happening.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FulfillmentWorklistPage } from './fulfillment-worklist-page';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import { FULFILLMENT_ACTION_COPY } from '../../features/fulfillment';
import type { FulfillmentTask } from '../../features/fulfillment';
import type { SessionUser } from '../../shared/auth/session.types';
import { ApiError } from '../../shared/api/api-error';

afterEach(cleanup);

const OPERATOR: SessionUser = {
  id: 'user_2',
  username: 'operator',
  email: 'operator@example.com',
  role: 'operator',
  permissions: ['orders:read', 'orders:write'],
};

function task(overrides: Partial<FulfillmentTask> = {}): FulfillmentTask {
  return {
    id: 'ol_work_1',
    orderId: 'ol_order_1',
    locationId: 'loc_warsaw',
    deliveryMethod: 'courier',
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
        totalQuantity: 5,
        fulfilledQuantity: 3,
        cancelledQuantity: 0,
      },
    ],
    activeHolds: [],
    supportedActions: ['close'],
    version: 3,
    ...overrides,
  };
}

function page(tasks: FulfillmentTask[], overrides: Record<string, unknown> = {}): unknown {
  return { works: tasks, total: tasks.length, limit: 25, offset: 0, ...overrides };
}

function renderPage(opts: {
  list?: ReturnType<typeof vi.fn>;
  applyAction?: ReturnType<typeof vi.fn>;
  route?: string;
}): { list: ReturnType<typeof vi.fn>; applyAction: ReturnType<typeof vi.fn> } {
  const list = opts.list ?? vi.fn().mockResolvedValue(page([task()]));
  const applyAction = opts.applyAction ?? vi.fn().mockResolvedValue(task());

  const api = createMockApiClient({
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false }) },
    fulfillment: { list, applyAction } as never,
  });

  renderWithProviders(<FulfillmentWorklistPage />, {
    apiClient: api,
    route: opts.route ?? '/fulfillment',
    sessionAdapter: createAuthenticatedSessionAdapter(OPERATOR),
  });

  return { list, applyAction };
}

/**
 * The desktop surface's container.
 *
 * Both surfaces are always in the DOM — the breakpoint is CSS, the house
 * pattern — so every role query below is scoped to one of them. An unscoped
 * `getByRole` finds each control twice.
 */
function desktop(): HTMLElement {
  return document.querySelector('.fulfilment-worklist__desktop') as HTMLElement;
}

/** The desktop surface's rows. */
function desktopTaskIds(): string[] {
  return [...document.querySelectorAll('.fulfilment-worklist__desktop > li')].map(
    (row) => row.querySelector('.fulfilment-worklist-row__id')?.textContent?.trim() ?? ''
  );
}

/** The card surface's rows. */
function cardTaskIds(): string[] {
  return [...document.querySelectorAll('.fulfilment-worklist__cards > li')].map(
    (card) => card.querySelector('.fulfilment-task__id')?.textContent?.trim() ?? ''
  );
}

describe('FulfillmentWorklistPage — the 409 path (AC2)', () => {
  it('refreshes and re-renders the server’s new action set on a version_conflict', async () => {
    const user = userEvent.setup();
    const list = vi
      .fn()
      .mockResolvedValueOnce(page([task({ version: 3, supportedActions: ['close'] })]))
      .mockResolvedValue(page([task({ version: 4, supportedActions: ['hold'] })]));
    const applyAction = vi.fn().mockRejectedValue(
      new ApiError('stale', 409, {
        code: 'version_conflict',
        currentVersion: 4,
        supportedActions: ['hold'],
      })
    );

    renderPage({ list, applyAction });

    await screen.findAllByRole('button', { name: FULFILLMENT_ACTION_COPY['close'].label });
    await user.click(
      within(desktop()).getByRole('button', { name: FULFILLMENT_ACTION_COPY['close'].label })
    );

    // (a) NO auto-retry, and the token that was RENDERED is the token sent.
    await waitFor(() => {
      expect(applyAction).toHaveBeenCalledTimes(1);
    });
    expect(applyAction).toHaveBeenCalledWith(
      'ol_work_1',
      'close',
      expect.objectContaining({ expectedVersion: 3 })
    );

    // (b) The refresh happened. EXACTLY twice — not `>= 1`, and not merely
    // "the promise settled": React Query settles either way, so this is the
    // assertion that goes red when the mutation's conflict branch is deleted
    // or its invalidation key is narrowed back to `worksByOrder`.
    await waitFor(() => {
      expect(list).toHaveBeenCalledTimes(2);
    });

    // (d) The refreshed action set is what renders. The label is read out of
    // the copy table rather than hardcoded, so a copy edit cannot make this
    // assertion silently stop asserting which action is offered.
    await waitFor(() => {
      expect(
        screen.getAllByRole('button', { name: FULFILLMENT_ACTION_COPY['hold'].label }).length
      ).toBeGreaterThan(0);
    });
    expect(
      screen.queryAllByRole('button', { name: FULFILLMENT_ACTION_COPY['close'].label })
    ).toEqual([]);

    // (c) Non-destructive: the row is still there.
    expect(desktopTaskIds()).toEqual(['ol_work_1']);
  });

  it('surfaces an action_not_legal without retrying and without destroying the row', async () => {
    const user = userEvent.setup();
    const list = vi.fn().mockResolvedValue(page([task()]));
    const applyAction = vi.fn().mockRejectedValue(
      new ApiError('not legal', 409, {
        code: 'action_not_legal',
        supportedActions: [],
      })
    );

    renderPage({ list, applyAction });

    await screen.findAllByRole('button', { name: FULFILLMENT_ACTION_COPY['close'].label });
    await user.click(
      within(desktop()).getByRole('button', { name: FULFILLMENT_ACTION_COPY['close'].label })
    );

    await waitFor(() => {
      expect(applyAction).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(list).toHaveBeenCalledTimes(2);
    });
    expect(desktopTaskIds()).toEqual(['ol_work_1']);
  });
});

describe('FulfillmentWorklistPage — both surfaces agree (AC3 part 1)', () => {
  it('renders the same set of tasks in the desktop rows and in the cards', async () => {
    // TWO tasks share a lane on purpose. With one task per lane, a per-lane
    // divergence (a `slice`, a filter, a `find` instead of a `map`) drops
    // nothing and the comparison passes while asserting nothing — which is
    // exactly what this case is here to catch.
    const tasks = [
      task({ id: 'ol_work_1', locationId: 'loc_warsaw' }),
      task({ id: 'ol_work_2', locationId: 'loc_warsaw' }),
      task({ id: 'ol_work_3', locationId: 'loc_krakow' }),
      task({ id: 'ol_work_4', locationId: null, deliveryMethod: null }),
    ];
    renderPage({ list: vi.fn().mockResolvedValue(page(tasks)) });

    await screen.findAllByRole('button', { name: FULFILLMENT_ACTION_COPY['close'].label });

    const desktop = desktopTaskIds();
    // Vacuity guards: two empty sets are trivially equal, and a single-task
    // lane cannot observe a per-lane divergence.
    expect(desktop.length).toBe(4);
    expect(
      desktop.filter((id) => id === 'ol_work_1' || id === 'ol_work_2').length
    ).toBe(2);
    // The breakpoint is CSS, so both surfaces are in the DOM; that they are
    // both present is incidental — showing DIFFERENT tasks is the real defect.
    expect(new Set(cardTaskIds())).toEqual(new Set(desktop));
    expect(cardTaskIds().length).toBe(desktop.length);
  });
});

describe('FulfillmentWorklistPage — four distinct states', () => {
  it('renders a loading line that is not an empty-state sentence', () => {
    renderPage({ list: vi.fn(() => new Promise(() => undefined)) });

    expect(screen.getByText('Loading fulfilment tasks…')).toBeInTheDocument();
    expect(screen.queryByText('Nothing to work right now')).not.toBeInTheDocument();
    expect(
      screen.queryByText('No fulfilment tasks match these filters')
    ).not.toBeInTheDocument();
  });

  it('renders an error with a retry, never the empty state', async () => {
    renderPage({ list: vi.fn().mockRejectedValue(new ApiError('boom', 500, {})) });

    expect(
      await screen.findByText('Could not load the fulfilment worklist')
    ).toBeInTheDocument();
    expect(screen.queryByText('Nothing to work right now')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('says "nothing to work" when nothing is filtered', async () => {
    renderPage({ list: vi.fn().mockResolvedValue(page([])) });

    expect(await screen.findByText('Nothing to work right now')).toBeInTheDocument();
  });

  it('says "no matches" when a filter is narrowing the list', async () => {
    renderPage({
      list: vi.fn().mockResolvedValue(page([])),
      route: '/fulfillment?orderId=ol_order_missing',
    });

    expect(
      await screen.findByText('No fulfilment tasks match these filters')
    ).toBeInTheDocument();
    expect(screen.queryByText('Nothing to work right now')).not.toBeInTheDocument();
  });

  it('says "nothing on this page" when paged past the end', async () => {
    // Paging past the end is neither of the two empty states: rows exist.
    renderPage({
      list: vi.fn().mockResolvedValue(page([], { total: 40, offset: 100 })),
      route: '/fulfillment?offset=100',
    });

    expect(await screen.findByText('Nothing on this page')).toBeInTheDocument();
    expect(screen.queryByText('Nothing to work right now')).not.toBeInTheDocument();
  });
});

describe('FulfillmentWorklistPage — the pager reads the applied page', () => {
  it('uses the limit the SERVER applied, not the one requested', async () => {
    // The server clamps, so a pager reading its own request would render a
    // range that does not describe the rows on screen.
    renderPage({
      list: vi.fn().mockResolvedValue(page([task()], { total: 60, limit: 25, offset: 0 })),
    });

    expect(await screen.findByText('Showing 1–25 of 60')).toBeInTheDocument();
  });

  it('asks for the page size the server will actually give', async () => {
    const { list } = renderPage({});

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ limit: 25, offset: 0 }));
    });
  });
});

describe('FulfillmentWorklistPage — filters reach the request', () => {
  it('sends both free-string filters read out of the URL', async () => {
    const { list } = renderPage({
      route: '/fulfillment?orderId=ol_order_7&locationId=loc_krakow',
    });

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'ol_order_7', locationId: 'loc_krakow' })
      );
    });
  });

  it('commits a filter on Enter, not only on blur', async () => {
    // A filter box that reacts only to blur reads as broken to anyone who
    // types and presses Enter.
    const user = userEvent.setup();
    const { list } = renderPage({});

    await waitFor(() => {
      expect(list).toHaveBeenCalledTimes(1);
    });

    await user.type(await screen.findByLabelText('Order'), 'ol_order_9{Enter}');

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'ol_order_9' }));
    });
  });

  it('clears the visible filter text when the filters are cleared', async () => {
    // The remedy the empty state offers must actually reset the control the
    // operator typed into: a box still showing `ol_order_7` over an unfiltered
    // list is the page contradicting itself.
    const user = userEvent.setup();
    renderPage({
      list: vi.fn().mockResolvedValue(page([])),
      route: '/fulfillment?orderId=ol_order_7',
    });

    const before = await screen.findByLabelText<HTMLInputElement>('Order');
    expect(before.value).toBe('ol_order_7');

    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);

    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Order').value).toBe('');
    });
  });

  it('offers a way out of a filter that matched nothing', async () => {
    renderPage({
      list: vi.fn().mockResolvedValue(page([])),
      route: '/fulfillment?orderId=nope',
    });

    await screen.findByText('No fulfilment tasks match these filters');
    // Two: the toolbar's and the empty state's own remedy.
    expect(
      screen.getAllByRole('button', { name: 'Clear filters' }).length
    ).toBeGreaterThan(0);
  });
});
