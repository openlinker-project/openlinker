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

function page(tasks: FulfillmentTask[]): unknown {
  return { works: tasks, total: tasks.length, limit: 100, offset: 0 };
}

function renderPage(opts: {
  list?: ReturnType<typeof vi.fn>;
  listPackers?: ReturnType<typeof vi.fn>;
  updateAssignment?: ReturnType<typeof vi.fn>;
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
    route: '/fulfillment/assign',
    sessionAdapter: createAuthenticatedSessionAdapter(OPERATOR),
  });

  return { list, listPackers, updateAssignment };
}

/**
 * The desktop surface's container — both surfaces are always in the DOM (the
 * breakpoint is CSS, `FulfillmentLaneSection`'s house pattern), so every role
 * query below is scoped to one of them or it finds each control twice.
 */
function desktop(): HTMLElement {
  return document.querySelector('.fulfilment-worklist__desktop') as HTMLElement;
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

  describe('self-serve checkbox + Hold button scoping', () => {
    it('renders both on an unassigned task', async () => {
      renderPage({});

      await screen.findAllByRole('checkbox', { name: 'Anyone may claim this' });
      expect(
        within(desktop()).getByRole('checkbox', { name: 'Anyone may claim this' })
      ).toBeInTheDocument();
      expect(within(desktop()).getByRole('button', { name: 'Hold' })).toBeInTheDocument();
    });

    it('renders NEITHER on a task already assigned to a packer — the mockup scoping bug', async () => {
      renderPage({
        list: vi.fn().mockResolvedValue(page([task({ assignedToUserId: 'u_a' })])),
      });

      await screen.findAllByRole('combobox', { name: 'Move to' });
      expect(screen.queryByRole('checkbox', { name: 'Anyone may claim this' })).not.toBeInTheDocument();
      expect(within(desktop()).queryByRole('button', { name: 'Hold' })).not.toBeInTheDocument();
      // "Move to" stays on every task, in every lane.
      expect(within(desktop()).getByRole('combobox', { name: 'Move to' })).toBeInTheDocument();
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
