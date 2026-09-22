/**
 * `AssignPackingWorkPage` (#3340, ADR-074).
 *
 * Covers what would break if the board's assembly regressed: tasks land in
 * the right swimlane, moving a task posts the right body, toggling
 * self-serve posts the right body, and a failed roster read degrades the
 * board rather than blocking it.
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssignPackingWorkPage } from './assign-packing-work-page';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import type { FulfillmentTask } from '../../features/fulfillment';
import type { SessionUser } from '../../shared/auth/session.types';

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
    assignedToUserId: null,
    selfServeEligible: true,
    status: 'open',
    requestStatus: 'unsubmitted',
    assignmentAttempt: 0,
    cancellationReason: null,
    externalWorkId: null,
    acceptedAt: null,
    cancelledAt: null,
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
    lines: [],
    activeHolds: [],
    supportedActions: ['hold'],
    version: 1,
    ...overrides,
  };
}

function page(
  tasks: FulfillmentTask[],
  overrides: { total?: number; limit?: number; offset?: number } = {}
): unknown {
  return {
    works: tasks,
    total: overrides.total ?? tasks.length,
    limit: overrides.limit ?? 25,
    offset: overrides.offset ?? 0,
  };
}

function renderPage(opts: {
  list?: ReturnType<typeof vi.fn>;
  listPackers?: ReturnType<typeof vi.fn>;
  updateAssignment?: ReturnType<typeof vi.fn>;
  route?: string;
}): {
  list: ReturnType<typeof vi.fn>;
  listPackers: ReturnType<typeof vi.fn>;
  updateAssignment: ReturnType<typeof vi.fn>;
} {
  const list = opts.list ?? vi.fn().mockResolvedValue(page([task()]));
  const listPackers =
    opts.listPackers ??
    vi.fn().mockResolvedValue({ packers: [{ id: 'u_a', username: 'packer-a' }] });
  const updateAssignment = opts.updateAssignment ?? vi.fn().mockResolvedValue(task());

  const api = createMockApiClient({
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false }) },
    fulfillment: { list, updateAssignment } as never,
    users: { listPackers } as never,
  });

  renderWithProviders(<AssignPackingWorkPage />, {
    apiClient: api,
    route: opts.route ?? '/fulfillment',
    sessionAdapter: createAuthenticatedSessionAdapter(OPERATOR),
  });

  return { list, listPackers, updateAssignment };
}

/**
 * The task list.
 *
 * This board used to render its tasks TWICE — a desktop row list and a mobile
 * card list, both always in the DOM with a CSS breakpoint choosing between
 * them — so every role query had to be scoped to one or it matched each
 * control twice. #3401 replaced both with one card that reflows, so the
 * scoping is no longer about avoiding duplicates; it is kept because a query
 * scoped to the list cannot accidentally match a control in the page header.
 */
function desktop(): HTMLElement {
  return document.querySelector('.assign-packing-work-card-list') as HTMLElement;
}

describe('AssignPackingWorkPage', () => {
  it('renders one lane per active packer plus a pinned Unassigned lane', async () => {
    renderPage({
      list: vi.fn().mockResolvedValue(page([task({ id: 'a', assignedToUserId: 'u_a' })])),
      listPackers: vi.fn().mockResolvedValue({
        packers: [
          { id: 'u_a', username: 'packer-a' },
          { id: 'u_b', username: 'packer-b' },
        ],
      }),
    });

    expect(await screen.findByRole('region', { name: 'Unassigned' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'packer-a' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'packer-b' })).toBeInTheDocument();
  });

  it('moving a task to a packer posts the assignment with that user id', async () => {
    const user = userEvent.setup();
    const { updateAssignment } = renderPage({});

    await screen.findAllByRole('combobox', { name: 'Move to' });
    const select = within(desktop()).getByRole('combobox', { name: 'Move to' });
    await user.selectOptions(select, 'packer-a');

    await waitFor(() => {
      expect(updateAssignment).toHaveBeenCalledWith('ol_work_1', { assignedToUserId: 'u_a' });
    });
  });

  it('moving a task back to Unassigned posts a null assignment', async () => {
    const user = userEvent.setup();
    const { updateAssignment } = renderPage({
      list: vi.fn().mockResolvedValue(page([task({ assignedToUserId: 'u_a' })])),
    });

    await screen.findAllByRole('combobox', { name: 'Move to' });
    const select = within(desktop()).getByRole('combobox', { name: 'Move to' });
    await user.selectOptions(select, 'Unassigned');

    await waitFor(() => {
      expect(updateAssignment).toHaveBeenCalledWith('ol_work_1', { assignedToUserId: null });
    });
  });

  it('toggling self-serve posts the eligibility flag alone', async () => {
    const user = userEvent.setup();
    const { updateAssignment } = renderPage({});

    await screen.findAllByRole('checkbox', { name: 'Anyone may claim this' });
    const checkbox = within(desktop()).getByRole('checkbox', { name: 'Anyone may claim this' });
    await user.click(checkbox);

    await waitFor(() => {
      expect(updateAssignment).toHaveBeenCalledWith('ol_work_1', { selfServeEligible: false });
    });
  });

  // ── #3429 — success toasts, assignment-only styling, control scoping ────
  describe('success toasts', () => {
    it('toasts on a successful move', async () => {
      const user = userEvent.setup();
      renderPage({});

      await screen.findAllByRole('combobox', { name: 'Move to' });
      const select = within(desktop()).getByRole('combobox', { name: 'Move to' });
      await user.selectOptions(select, 'packer-a');

      expect(await screen.findByText('Task moved.')).toBeInTheDocument();
    });

    it('toasts on a successful self-serve toggle, with its own message', async () => {
      const user = userEvent.setup();
      renderPage({});

      await screen.findAllByRole('checkbox', { name: 'Anyone may claim this' });
      const checkbox = within(desktop()).getByRole('checkbox', { name: 'Anyone may claim this' });
      await user.click(checkbox);

      expect(await screen.findByText('Self-serve eligibility updated.')).toBeInTheDocument();
      expect(screen.queryByText('Task moved.')).not.toBeInTheDocument();
    });

    it('does not toast success on a failed move — only the existing error path fires', async () => {
      const user = userEvent.setup();
      renderPage({ updateAssignment: vi.fn().mockRejectedValue(new Error('boom')) });

      await screen.findAllByRole('combobox', { name: 'Move to' });
      const select = within(desktop()).getByRole('combobox', { name: 'Move to' });
      await user.selectOptions(select, 'packer-a');

      expect(
        await screen.findByText('Could not move this task. Nothing has changed.')
      ).toBeInTheDocument();
      expect(screen.queryByText('Task moved.')).not.toBeInTheDocument();
    });
  });

  describe('self-serve checkbox scoping', () => {
    it('renders the checkbox on an unassigned task', async () => {
      renderPage({});

      await screen.findAllByRole('checkbox', { name: 'Anyone may claim this' });
      expect(
        within(desktop()).getByRole('checkbox', { name: 'Anyone may claim this' })
      ).toBeInTheDocument();
    });

    it('renders no checkbox on a task already assigned to a packer', async () => {
      renderPage({
        list: vi.fn().mockResolvedValue(page([task({ assignedToUserId: 'u_a' })])),
      });

      await screen.findAllByRole('combobox', { name: 'Move to' });
      expect(screen.queryByRole('checkbox', { name: 'Anyone may claim this' })).not.toBeInTheDocument();
      // "Move to" stays on every task, in every lane.
      expect(within(desktop()).getByRole('combobox', { name: 'Move to' })).toBeInTheDocument();
    });

    it('offers Release hold on a held task — the gate this screen used to be missing', async () => {
      renderPage({
        list: vi.fn().mockResolvedValue(
          page([
            task({
              supportedActions: ['release_hold'],
              activeHolds: [
                {
                  id: 'hold_1',
                  reason: 'stock_shortfall',
                  note: null,
                  placedAt: '2026-09-22T10:00:00.000Z',
                },
              ],
            }),
          ])
        ),
      });

      await screen.findAllByRole('combobox', { name: 'Move to' });
      expect(within(desktop()).getByRole('button', { name: 'Release hold' })).toBeInTheDocument();
    });

    it('offers no button when the server allows a release but reports no hold', async () => {
      // A state this surface cannot act on: a control that cannot be completed
      // is worse than none.
      renderPage({
        list: vi
          .fn()
          .mockResolvedValue(page([task({ supportedActions: ['release_hold'], activeHolds: [] })])),
      });

      await screen.findAllByRole('combobox', { name: 'Move to' });
      expect(within(desktop()).queryByRole('button', { name: /release hold/i })).not.toBeInTheDocument();
    });

    it('keeps the action set on an assigned task, because the SERVER decides it', async () => {
      // The old assertion here was that Hold disappeared once a task was
      // assigned. That was the screen's own lane-based gate, and it is what
      // made this a one-way gate: a held task could never be released from
      // the only screen that could hold it. `supportedActions` is the gate
      // now, so an assigned task still offers whatever the server declared.
      renderPage({
        list: vi.fn().mockResolvedValue(page([task({ assignedToUserId: 'u_a' })])),
      });

      await screen.findAllByRole('combobox', { name: 'Move to' });
      expect(within(desktop()).getByRole('button', { name: 'Put on hold' })).toBeInTheDocument();
    });
  });

  describe('lane header presentation additions', () => {
    it('renders the Unassigned lane subtitle', async () => {
      renderPage({});

      const unassignedLane = await screen.findByRole('region', { name: 'Unassigned' });
      expect(
        within(unassignedLane).getByText('Visible to every packer until claimed or assigned')
      ).toBeInTheDocument();
    });

    it('mutes an unassigned, non-self-serve task and does not mute an ordinary one', async () => {
      renderPage({
        list: vi.fn().mockResolvedValue(
          page([
            task({ id: 'a', assignedToUserId: null, selfServeEligible: false }),
            task({ id: 'b', assignedToUserId: null, selfServeEligible: true }),
          ])
        ),
      });

      await screen.findAllByRole('checkbox', { name: 'Anyone may claim this' });
      const rowA = within(desktop()).getByText('a').closest('li') as HTMLElement;
      const rowB = within(desktop()).getByText('b').closest('li') as HTMLElement;

      expect(rowA.className).toContain('assign-packing-work-lane-card--assignment-only');
      expect(rowB.className).not.toContain('assign-packing-work-lane-card--assignment-only');
    });

    it('never mutes an assigned task, whatever its selfServeEligible value', async () => {
      renderPage({
        list: vi.fn().mockResolvedValue(
          page([task({ assignedToUserId: 'u_a', selfServeEligible: false })])
        ),
      });

      await screen.findAllByRole('combobox', { name: 'Move to' });
      const row = within(desktop()).getByText('ol_work_1').closest('li') as HTMLElement;
      expect(row.className).not.toContain('assign-packing-work-lane-card--assignment-only');
    });
  });

  it('degrades to a roster-error banner without blocking the board on a failed packer read', async () => {
    renderPage({ listPackers: vi.fn().mockRejectedValue(new Error('boom')) });

    expect(
      await screen.findByText(
        'The packer roster could not be loaded, so tasks can only be held or left unassigned.'
      )
    ).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Unassigned' })).toBeInTheDocument();
  });

  it('shows the empty state when there is no work to assign', async () => {
    renderPage({ list: vi.fn().mockResolvedValue(page([])) });

    expect(await screen.findByText('Nothing to assign right now')).toBeInTheDocument();
  });

  // ── #3428 — the metric row ───────────────────────────────────────────
  describe('the metric row', () => {
    it('counts only the pinned Unassigned lane, never assigned tasks', async () => {
      renderPage({
        list: vi.fn().mockResolvedValue(
          page([
            task({ id: 'a', assignedToUserId: null }),
            task({ id: 'b', assignedToUserId: null }),
            task({ id: 'c', assignedToUserId: 'u_a' }),
          ])
        ),
        listPackers: vi.fn().mockResolvedValue({ packers: [{ id: 'u_a', username: 'packer-a' }] }),
      });

      await screen.findAllByRole('combobox', { name: 'Move to' });
      const card = screen.getByText('Unassigned right now').closest('.metric-card') as HTMLElement;
      expect(within(card).getByText('2')).toBeInTheDocument();
    });

    it('does not render until the board has real data — no loading-flicker zero', () => {
      renderPage({ list: vi.fn(() => new Promise(() => {})) });

      expect(screen.queryByText('Unassigned right now')).not.toBeInTheDocument();
    });
  });

  // ── #3426 — native drag-and-drop, additive to "Move to" ──────────────
  describe('drag-and-drop lane reassignment', () => {
    /** A minimal `DataTransfer` stub — happy-dom does not implement one. */
    function fakeDataTransfer(): DataTransfer {
      return {
        setData: vi.fn(),
        effectAllowed: '',
      } as unknown as DataTransfer;
    }

    function draggableRow(): HTMLElement {
      return within(desktop()).getByText('ol_work_1').closest('li') as HTMLElement;
    }

    it('dragging a task onto a different lane posts the same assignment the "Move to" select uses', async () => {
      const { updateAssignment } = renderPage({
        listPackers: vi.fn().mockResolvedValue({
          packers: [
            { id: 'u_a', username: 'packer-a' },
            { id: 'u_b', username: 'packer-b' },
          ],
        }),
      });

      await screen.findAllByRole('combobox', { name: 'Move to' });
      const sourceRow = draggableRow();
      const destinationLane = screen.getByRole('region', { name: 'packer-a' });

      fireEvent.dragStart(sourceRow, { dataTransfer: fakeDataTransfer() });
      fireEvent.dragOver(destinationLane, { dataTransfer: fakeDataTransfer() });
      fireEvent.drop(destinationLane, { dataTransfer: fakeDataTransfer() });

      await waitFor(() => {
        expect(updateAssignment).toHaveBeenCalledWith('ol_work_1', { assignedToUserId: 'u_a' });
      });
    });

    it('dropping onto the task\'s own current lane is a no-op', async () => {
      const { updateAssignment } = renderPage({
        list: vi.fn().mockResolvedValue(page([task({ assignedToUserId: 'u_a' })])),
        listPackers: vi.fn().mockResolvedValue({ packers: [{ id: 'u_a', username: 'packer-a' }] }),
      });

      await screen.findAllByRole('combobox', { name: 'Move to' });
      const sourceRow = draggableRow();
      const ownLane = screen.getByRole('region', { name: 'packer-a' });

      fireEvent.dragStart(sourceRow, { dataTransfer: fakeDataTransfer() });
      fireEvent.dragOver(ownLane, { dataTransfer: fakeDataTransfer() });
      fireEvent.drop(ownLane, { dataTransfer: fakeDataTransfer() });

      // Give any wrongly-fired mutation a tick to land before asserting absence.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(updateAssignment).not.toHaveBeenCalled();
    });

    it('the "Move to" select keeps working exactly as before, drag or no drag', async () => {
      const user = userEvent.setup();
      const { updateAssignment } = renderPage({});

      await screen.findAllByRole('combobox', { name: 'Move to' });
      const select = within(desktop()).getByRole('combobox', { name: 'Move to' });
      await user.selectOptions(select, 'packer-a');

      await waitFor(() => {
        expect(updateAssignment).toHaveBeenCalledWith('ol_work_1', { assignedToUserId: 'u_a' });
      });
    });

    it('marks the row draggable only for a session that may write', async () => {
      renderPage({});

      await screen.findAllByRole('combobox', { name: 'Move to' });
      expect(draggableRow()).toHaveAttribute('draggable', 'true');
    });
  });

  // ── #3427 — avatar, lightest-load tag, load bar, lane accent ────────────
  describe('lane header presentation', () => {
    it('renders an initials avatar for a packer lane and a warning icon for Unassigned', async () => {
      renderPage({
        listPackers: vi.fn().mockResolvedValue({
          packers: [{ id: 'u_a', username: 'Marta Kowalczyk' }],
        }),
      });

      const packerLane = await screen.findByRole('region', { name: 'Marta Kowalczyk' });
      expect(within(packerLane).getByText('MK')).toBeInTheDocument();

      const unassignedLane = screen.getByRole('region', { name: 'Unassigned' });
      expect(within(unassignedLane).getByText('✳')).toBeInTheDocument();
    });

    it('tags the packer with the fewest tasks "lightest load", and no one else', async () => {
      renderPage({
        list: vi.fn().mockResolvedValue(
          page([
            task({ id: 'a', assignedToUserId: 'u_a' }),
            task({ id: 'b', assignedToUserId: 'u_a' }),
            task({ id: 'c', assignedToUserId: 'u_b' }),
          ])
        ),
        listPackers: vi.fn().mockResolvedValue({
          packers: [
            { id: 'u_a', username: 'packer-a' },
            { id: 'u_b', username: 'packer-b' },
          ],
        }),
      });

      const laneA = await screen.findByRole('region', { name: 'packer-a' });
      const laneB = screen.getByRole('region', { name: 'packer-b' });

      expect(within(laneB).getByText('lightest load')).toBeInTheDocument();
      expect(within(laneA).queryByText('lightest load')).not.toBeInTheDocument();
    });

    it('reads the load-bar fill width and tone off the same task count shown beside it', async () => {
      renderPage({
        list: vi.fn().mockResolvedValue(
          page(
            Array.from({ length: 3 }, (_, i) =>
              task({ id: `t${String(i)}`, assignedToUserId: 'u_a' })
            )
          )
        ),
        listPackers: vi.fn().mockResolvedValue({ packers: [{ id: 'u_a', username: 'packer-a' }] }),
      });

      const lane = await screen.findByRole('region', { name: 'packer-a' });
      const fill = lane.querySelector('.assign-packing-work-lane__load-fill') as HTMLElement;

      // 3 tasks -> 60% width, "busy" tone (>= 3).
      expect(fill.style.width).toBe('60%');
      expect(fill.className).toContain('assign-packing-work-lane__load-fill--busy');
    });
  });
});

// ── Filters and paging, moved from the worklist this screen absorbed ──────
//
// These are the capabilities the board did not have. Before the merge it
// asked for a flat 100 and rendered whatever came back, so past that it
// showed a slice — and grouped by packer, a slice means a lane looks empty
// when it is not.

describe('the merged screen — empty states are three, not one', () => {
  it('says "no matches" when a filter is narrowing the board', async () => {
    renderPage({
      list: vi.fn().mockResolvedValue(page([])),
      route: '/fulfillment?orderId=ol_order_missing',
    });

    expect(await screen.findByText('No fulfilment tasks match these filters')).toBeInTheDocument();
  });

  it('says "nothing on this page" when paged past the end', async () => {
    // Neither of the other two: rows exist, this page is simply beyond them.
    renderPage({
      list: vi.fn().mockResolvedValue(page([], { total: 40, offset: 100 })),
      route: '/fulfillment?offset=100',
    });

    expect(await screen.findByText('Nothing on this page')).toBeInTheDocument();
  });

  it('offers a way out of the filtered empty state', async () => {
    renderPage({
      list: vi.fn().mockResolvedValue(page([])),
      route: '/fulfillment?orderId=ol_order_missing',
    });

    await screen.findByText('No fulfilment tasks match these filters');
    expect(screen.getAllByRole('button', { name: 'Clear filters' }).length).toBeGreaterThan(0);
  });
});

describe('the merged screen — the pager reads the APPLIED page', () => {
  it('uses the limit the server applied, not the one requested', async () => {
    // The server clamps, so a pager reading its own request would render a
    // range that does not describe the lanes on screen.
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

  it('states once, not per lane, that a lane holds only this page', async () => {
    renderPage({
      list: vi
        .fn()
        .mockResolvedValue(page([task({ id: 'a', assignedToUserId: 'u_a' }), task({ id: 'b' })])),
    });

    // Two lanes render; the caveat is a fact about the board, so it appears
    // once rather than on each of them.
    expect(await screen.findAllByText('Grouped from the tasks on this page only.')).toHaveLength(1);
  });
});

describe('the merged screen — the grouping axis', () => {
  it('groups by packer by default', async () => {
    renderPage({
      list: vi.fn().mockResolvedValue(page([task({ assignedToUserId: 'u_a' })])),
    });

    expect(await screen.findByRole('region', { name: 'packer-a' })).toBeInTheDocument();
  });

  it('groups by location and delivery method when asked', async () => {
    renderPage({
      list: vi.fn().mockResolvedValue(page([task({ locationId: 'loc_warsaw' })])),
      route: '/fulfillment?groupBy=location',
    });

    expect(await screen.findByRole('region', { name: 'loc_warsaw · courier' })).toBeInTheDocument();
    // The packer lanes are gone — this is a different question about the
    // same rows, not an extra section.
    expect(screen.queryByRole('region', { name: 'packer-a' })).not.toBeInTheDocument();
  });

  it('turns drag OFF on the location axis, because a lane id is not a user id', async () => {
    // The drop handler PATCHes `assignedToUserId` with the lane it was
    // dropped on. On this axis that would send a location key as a user id,
    // and the handler cannot tell — a lane id is an opaque string.
    renderPage({
      list: vi.fn().mockResolvedValue(page([task({ locationId: 'loc_warsaw' })])),
      route: '/fulfillment?groupBy=location',
    });

    await screen.findByRole('region', { name: 'loc_warsaw · courier' });
    const card = document.querySelector('[data-testid="assign-packing-work-card"]');
    expect(card?.getAttribute('draggable')).not.toBe('true');
  });

  it('keeps drag on the packer axis', async () => {
    renderPage({});

    await screen.findAllByRole('combobox', { name: 'Move to' });
    const card = document.querySelector('[data-testid="assign-packing-work-card"]');
    expect(card?.getAttribute('draggable')).toBe('true');
  });

  it('says why drag is unavailable rather than letting it silently stop working', async () => {
    renderPage({
      list: vi.fn().mockResolvedValue(page([task({ locationId: 'loc_warsaw' })])),
      route: '/fulfillment?groupBy=location',
    });

    expect(
      await screen.findByText('Drag moves a task between packers — switch to Packer to use it.')
    ).toBeInTheDocument();
  });

  it('drops the offset when the axis changes', async () => {
    // Row 26 of one grouping is not row 26 of the other.
    const user = userEvent.setup();
    const { list } = renderPage({
      list: vi.fn().mockResolvedValue(page([task()], { total: 90, offset: 25 })),
      route: '/fulfillment?offset=25',
    });

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ offset: 25 }));
    });

    await user.click(await screen.findByRole('radio', { name: 'Location' }));

    await waitFor(() => {
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }));
    });
  });
});

describe('the merged screen — filters reach the request', () => {
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
    // A box still showing `ol_order_7` over an unfiltered board is the screen
    // contradicting itself.
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

  it('does not send a present-but-empty filter as a value', async () => {
    // `?orderId=` would otherwise filter to orders whose id is the empty
    // string — none — while the screen reported itself unfiltered.
    const { list } = renderPage({ route: '/fulfillment?orderId=' });

    await waitFor(() => {
      expect(list).toHaveBeenCalledTimes(1);
    });
    expect(list.mock.calls[0][0]).not.toHaveProperty('orderId', '');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });
});
