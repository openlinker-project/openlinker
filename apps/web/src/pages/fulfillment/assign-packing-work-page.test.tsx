/**
 * `AssignPackingWorkPage` (#3340, ADR-074; mockup parity #3096).
 *
 * Covers what would break if the board's assembly regressed: tasks land in
 * the right swimlane, the `Assign to…` / `Move to…` menu posts the right body,
 * toggling self-serve posts the right body, a failed roster read degrades the
 * board rather than blocking it, and — since #3096 — the board is admin +
 * operator only, asks for active work only, and offers the location axis only
 * where there is more than one location.
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
import { ApiError } from '../../shared/api/api-error';

afterEach(cleanup);

const OPERATOR: SessionUser = {
  id: 'user_2',
  username: 'operator',
  email: 'operator@example.com',
  role: 'operator',
  permissions: ['orders:read', 'orders:write'],
};

const POOL_LABEL = 'Anyone can pick this up';
const ASSIGNED_LABEL = 'Anyone can still pick this up';
const ASSIGN_MENU = /^(Assign|Move) to…$/;

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
  user?: SessionUser;
  activeLocations?: number;
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
    inventory: {
      listActiveLocations: vi
        .fn()
        .mockResolvedValue({ items: [], total: opts.activeLocations ?? 1, page: 1, limit: 1 }),
    } as never,
  });

  renderWithProviders(<AssignPackingWorkPage />, {
    apiClient: api,
    route: opts.route ?? '/fulfillment',
    sessionAdapter: createAuthenticatedSessionAdapter(opts.user ?? OPERATOR),
  });

  return { list, listPackers, updateAssignment };
}

/**
 * The task list, so a query cannot accidentally match a control in the page
 * header or the toolbar.
 */
function board(): HTMLElement {
  return document.querySelector('.assign-packing-work-board') as HTMLElement;
}

/** Open a row's assignment menu and choose an entry from it. */
async function chooseAssignee(
  user: ReturnType<typeof userEvent.setup>,
  item: RegExp,
  rowIndex = 0
): Promise<void> {
  await user.click(within(board()).getAllByRole('button', { name: ASSIGN_MENU })[rowIndex]);
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

async function findMenus(): Promise<HTMLElement[]> {
  return await screen.findAllByRole('button', { name: ASSIGN_MENU });
}

describe('AssignPackingWorkPage', () => {
  describe('who may open it (#3096)', () => {
    it('should render access denied, and read nothing, when the session lacks orders:write', async () => {
      const { list, listPackers } = renderPage({
        user: { ...OPERATOR, role: 'viewer', permissions: ['orders:read'] },
      });

      expect(
        await screen.findByRole('heading', { name: 'The fulfilment board is for supervisors' })
      ).toBeInTheDocument();
      expect(list).not.toHaveBeenCalled();
      expect(listPackers).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });
  });

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

  it('should ask the server for active work only, by alias rather than a status list', async () => {
    const { list } = renderPage({});

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
    });
    expect(list.mock.calls[0][0]).not.toHaveProperty('status');
  });

  describe('the assignment menu (#3096)', () => {
    it('should say Assign to… on a pooled task and Move to… on an assigned one', async () => {
      renderPage({
        list: vi
          .fn()
          .mockResolvedValue(page([task({ id: 'a' }), task({ id: 'b', assignedToUserId: 'u_a' })])),
      });

      await findMenus();
      expect(within(board()).getByRole('button', { name: 'Assign to…' })).toBeInTheDocument();
      expect(within(board()).getByRole('button', { name: 'Move to…' })).toBeInTheDocument();
    });

    it('posts the assignment with the chosen packer id', async () => {
      const user = userEvent.setup();
      const { updateAssignment } = renderPage({});

      await findMenus();
      await chooseAssignee(user, /^packer-a/);

      await waitFor(() => {
        expect(updateAssignment).toHaveBeenCalledWith('ol_work_1', {
          assignedToUserId: 'u_a',
          expectedVersion: 1,
        });
      });
    });

    it("should list each packer with their queue on this page", async () => {
      const user = userEvent.setup();
      renderPage({
        list: vi.fn().mockResolvedValue(
          page([
            task({ id: 'a' }),
            task({ id: 'b', assignedToUserId: 'u_b' }),
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

      await findMenus();
      await user.click(within(board()).getByRole('button', { name: 'Assign to…' }));

      expect(await screen.findByRole('menuitem', { name: 'packer-a (0)' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'packer-b (2)' })).toBeInTheDocument();
      // A pooled task has nowhere to be pulled back FROM.
      expect(screen.queryByRole('menuitem', { name: /Pull back to Unassigned/ })).not.toBeInTheDocument();
    });

    it('should offer Pull back to Unassigned on an assigned task, and post a null assignment', async () => {
      const user = userEvent.setup();
      const { updateAssignment } = renderPage({
        list: vi.fn().mockResolvedValue(page([task({ assignedToUserId: 'u_a' })])),
      });

      await findMenus();
      // The task's own packer is not offered as a destination.
      await user.click(within(board()).getByRole('button', { name: 'Move to…' }));
      expect(screen.queryByRole('menuitem', { name: /^packer-a/ })).not.toBeInTheDocument();
      await user.click(await screen.findByRole('menuitem', { name: /Pull back to Unassigned/ }));

      await waitFor(() => {
        expect(updateAssignment).toHaveBeenCalledWith('ol_work_1', {
          assignedToUserId: null,
          expectedVersion: 1,
        });
      });
    });

    it('sends the version the row was RENDERED with, not a hardcoded 1', async () => {
      const user = userEvent.setup();
      const { updateAssignment } = renderPage({
        list: vi.fn().mockResolvedValue(page([task({ version: 7 })])),
      });

      await findMenus();
      await chooseAssignee(user, /^packer-a/);

      await waitFor(() => {
        expect(updateAssignment).toHaveBeenCalledWith('ol_work_1', {
          assignedToUserId: 'u_a',
          expectedVersion: 7,
        });
      });
    });

    it('sends the CURRENT rendered version after the board refreshes, not the one from initial mount', async () => {
      const user = userEvent.setup();
      const list = vi
        .fn()
        .mockResolvedValueOnce(page([task({ version: 3, assignedToUserId: null })]))
        .mockResolvedValueOnce(page([task({ version: 4, assignedToUserId: null })]));
      const { updateAssignment } = renderPage({ list });

      await screen.findAllByRole('checkbox', { name: POOL_LABEL });
      await user.click(within(board()).getByRole('checkbox', { name: POOL_LABEL }));

      await waitFor(() => {
        expect(updateAssignment).toHaveBeenNthCalledWith(1, 'ol_work_1', {
          selfServeEligible: false,
          expectedVersion: 3,
        });
      });
      await waitFor(() => {
        expect(list).toHaveBeenCalledTimes(2);
      });
      await findMenus();
      await chooseAssignee(user, /^packer-a/);

      await waitFor(() => {
        expect(updateAssignment).toHaveBeenNthCalledWith(2, 'ol_work_1', {
          assignedToUserId: 'u_a',
          expectedVersion: 4,
        });
      });
    });
  });

  describe('self-serve', () => {
    it('offers the self-serve control on an ASSIGNED row, where it is the hard lock', async () => {
      const user = userEvent.setup();
      const { updateAssignment } = renderPage({
        list: vi.fn().mockResolvedValue(page([task({ assignedToUserId: 'u_a' })])),
      });

      await user.click(await screen.findByRole('checkbox', { name: ASSIGNED_LABEL }));

      await waitFor(() => {
        expect(updateAssignment).toHaveBeenCalledWith('ol_work_1', {
          selfServeEligible: false,
          expectedVersion: 1,
        });
      });
    });

    it('toggling self-serve posts the eligibility flag alone', async () => {
      const user = userEvent.setup();
      const { updateAssignment } = renderPage({});

      await user.click(await screen.findByRole('checkbox', { name: POOL_LABEL }));

      await waitFor(() => {
        expect(updateAssignment).toHaveBeenCalledWith('ol_work_1', {
          selfServeEligible: false,
          expectedVersion: 1,
        });
      });
    });

    it('should word the pooled and the assigned checkbox differently', async () => {
      renderPage({
        list: vi
          .fn()
          .mockResolvedValue(page([task({ id: 'a' }), task({ id: 'b', assignedToUserId: 'u_a' })])),
      });

      expect(await screen.findByRole('checkbox', { name: POOL_LABEL })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: ASSIGNED_LABEL })).toBeInTheDocument();
    });
  });

  describe('success toasts', () => {
    it('toasts on a successful move', async () => {
      const user = userEvent.setup();
      renderPage({});

      await findMenus();
      await chooseAssignee(user, /^packer-a/);

      expect(await screen.findByText('Task moved.')).toBeInTheDocument();
    });

    it('toasts on a successful self-serve toggle, with its own message', async () => {
      const user = userEvent.setup();
      renderPage({});

      await user.click(await screen.findByRole('checkbox', { name: POOL_LABEL }));

      expect(await screen.findByText('Self-serve eligibility updated.')).toBeInTheDocument();
      expect(screen.queryByText('Task moved.')).not.toBeInTheDocument();
    });

    it('does not toast success on a failed move, and does not claim nothing happened', async () => {
      const user = userEvent.setup();
      renderPage({ updateAssignment: vi.fn().mockRejectedValue(new Error('boom')) });

      await findMenus();
      await chooseAssignee(user, /^packer-a/);

      expect(
        await screen.findByText(
          'That did not go through, and we could not tell whether it landed. Check the board.'
        )
      ).toBeInTheDocument();
      expect(screen.queryByText('Task moved.')).not.toBeInTheDocument();
    });

    it('says somebody got there first on a 409, and actually refreshes the board', async () => {
      const list = vi.fn().mockResolvedValue(page([task()]));
      const user = userEvent.setup();
      renderPage({
        list,
        updateAssignment: vi.fn().mockRejectedValue(new ApiError('conflict', 409, null)),
      });

      await findMenus();
      await chooseAssignee(user, /^packer-a/);

      expect(
        await screen.findByText('Somebody changed this task first. The board has been refreshed.')
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(list).toHaveBeenCalledTimes(2);
      });
    });

    it('names a refused self-serve toggle as its own thing, not as a failed move', async () => {
      const user = userEvent.setup();
      renderPage({
        updateAssignment: vi.fn().mockRejectedValue(new ApiError('bad request', 400, null)),
      });

      await user.click(await screen.findByRole('checkbox', { name: POOL_LABEL }));

      expect(
        await screen.findByText('Could not change who may claim this. Nothing has changed.')
      ).toBeInTheDocument();
      expect(screen.queryByText('Could not move this task. Nothing has changed.')).not.toBeInTheDocument();
    });
  });

  describe('the action set', () => {
    it('offers Release hold on a held task — the gate this screen used to be missing', async () => {
      const user = userEvent.setup();
      renderPage({
        list: vi.fn().mockResolvedValue(
          page([
            task({
              supportedActions: ['release_hold'],
              activeHolds: [
                { id: 'hold_1', reason: 'stock_shortfall', note: null, placedAt: '2026-09-22T10:00:00.000Z' },
              ],
            }),
          ])
        ),
      });

      await findMenus();
      await user.click(within(board()).getByRole('button', { name: 'More actions' }));
      expect(await screen.findByRole('button', { name: 'Release hold' })).toBeInTheDocument();
    });

    it('offers no button when the server allows a release but reports no hold', async () => {
      renderPage({
        list: vi
          .fn()
          .mockResolvedValue(page([task({ supportedActions: ['release_hold'], activeHolds: [] })])),
      });

      await findMenus();
      expect(within(board()).queryByRole('button', { name: /release hold/i })).not.toBeInTheDocument();
    });

    it('keeps the action set on an assigned task, because the SERVER decides it', async () => {
      const user = userEvent.setup();
      renderPage({
        list: vi.fn().mockResolvedValue(page([task({ assignedToUserId: 'u_a' })])),
      });

      await findMenus();
      await user.click(within(board()).getByRole('button', { name: 'More actions' }));
      expect(await screen.findByRole('button', { name: 'Put on hold' })).toBeInTheDocument();
    });

    it('should keep the overflow slot on a row with no action, so the columns line up (#3096)', async () => {
      renderPage({
        list: vi
          .fn()
          .mockResolvedValue(page([task({ id: 'a' }), task({ id: 'b', supportedActions: [] })])),
      });

      await findMenus();
      expect(within(board()).getAllByRole('button', { name: 'More actions' })).toHaveLength(1);
      expect(within(board()).getAllByTestId('assign-packing-work-menu-slot')).toHaveLength(1);
    });
  });

  describe('the row (#3096)', () => {
    it('should shorten a long reference the way the orders lists do, and keep it a plain link', async () => {
      renderPage({
        list: vi
          .fn()
          .mockResolvedValue(page([task({ orderReference: '1a7a9550-bd84-11f1-a5f3-e32e252d5e3f' })])),
      });

      const ref = await within(await screen.findByRole('region', { name: 'Unassigned' })).findByRole(
        'link',
        { name: '1a7a9550…2d5e3f' }
      );
      expect(ref).toHaveAttribute('title', '1a7a9550-bd84-11f1-a5f3-e32e252d5e3f');
      expect(ref).not.toHaveClass('link');
    });

    it('should say what the packer will scan, in the mockup wording', async () => {
      renderPage({
        list: vi.fn().mockResolvedValue(
          page([
            task({
              id: 'a',
              lines: [
                { id: 'l1', orderLineId: 'o1', productVariantId: 'v1', totalQuantity: 1, fulfilledQuantity: 0, cancelledQuantity: 0 },
              ],
            }),
            task({
              id: 'b',
              lines: [
                { id: 'l1', orderLineId: 'o1', productVariantId: 'v1', totalQuantity: 3, fulfilledQuantity: 0, cancelledQuantity: 0 },
                { id: 'l2', orderLineId: 'o2', productVariantId: 'v2', totalQuantity: 1, fulfilledQuantity: 0, cancelledQuantity: 0 },
              ],
            }),
          ])
        ),
      });

      expect(await screen.findByText('1 product to scan')).toBeInTheDocument();
      expect(screen.getByText('2 products, 4 units to scan')).toBeInTheDocument();
    });

    it('should leave the location off the row on a one-location install', async () => {
      renderPage({
        list: vi.fn().mockResolvedValue(page([task({ locationName: 'Main warehouse' })])),
      });

      await findMenus();
      expect(within(board()).queryByText(/Main warehouse/)).not.toBeInTheDocument();
    });

    it('should name the location on the row when the install has several', async () => {
      renderPage({
        list: vi.fn().mockResolvedValue(page([task({ locationName: 'Berlin' })])),
        activeLocations: 2,
      });

      expect(await within(await screen.findByRole('region', { name: 'Unassigned' })).findByText(/· Berlin/)).toBeInTheDocument();
    });
  });

  describe('lane header presentation', () => {
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

      await findMenus();
      const rowA = within(board()).getByText('a').closest('li') as HTMLElement;
      const rowB = within(board()).getByText('b').closest('li') as HTMLElement;
      expect(rowA.className).toContain('assign-packing-work-lane-card--assignment-only');
      expect(rowB.className).not.toContain('assign-packing-work-lane-card--assignment-only');
    });

    it('renders an initials avatar for a packer lane and a warning icon for Unassigned', async () => {
      renderPage({
        listPackers: vi.fn().mockResolvedValue({ packers: [{ id: 'u_a', username: 'Marta Kowalczyk' }] }),
      });

      const packerLane = await screen.findByRole('region', { name: 'Marta Kowalczyk' });
      expect(within(packerLane).getByText('MK')).toBeInTheDocument();
      expect(within(screen.getByRole('region', { name: 'Unassigned' })).getByText('✳')).toBeInTheDocument();
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
          page(Array.from({ length: 3 }, (_, i) => task({ id: `t${String(i)}`, assignedToUserId: 'u_a' })))
        ),
        listPackers: vi.fn().mockResolvedValue({ packers: [{ id: 'u_a', username: 'packer-a' }] }),
      });

      const lane = await screen.findByRole('region', { name: 'packer-a' });
      const fill = lane.querySelector('.assign-packing-work-lane__load-fill') as HTMLElement;
      expect(fill.style.width).toBe('60%');
      expect(fill.className).toContain('assign-packing-work-lane__load-fill--busy');
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

  it('should draw the lane skeleton, not a bare sentence, while the first page loads (#3096)', async () => {
    renderPage({ list: vi.fn(() => new Promise(() => {})) });

    expect(await screen.findByText('Loading packing work…')).toHaveClass('sr-only');
    expect(document.querySelector('.assign-packing-work-skeleton')).not.toBeNull();
  });

  describe('the metric row', () => {
    function metric(label: string): HTMLElement {
      return screen.getByText(label).closest('.kpi-card') as HTMLElement;
    }

    it('should lay the three cards out in the mockup order: Unassigned, Packers, Oldest (#3096)', async () => {
      renderPage({});

      await screen.findByText('Unassigned right now');
      const grid = document.querySelector('.assign-packing-work-metrics') as HTMLElement;
      expect(grid).toHaveClass('kpi-grid');
      const labels = [...grid.querySelectorAll('.kpi-card__label-text')].map((n) => n.textContent);
      expect(labels).toEqual(['Unassigned right now', 'Packers at their benches', 'Oldest unassigned']);
      for (const card of grid.querySelectorAll('.kpi-card')) expect(card).toHaveClass('kpi-card--compact');
    });

    it('counts only unassigned tasks, never assigned ones', async () => {
      renderPage({
        list: vi.fn().mockResolvedValue(
          page([
            task({ id: 'a', assignedToUserId: null }),
            task({ id: 'b', assignedToUserId: null }),
            task({ id: 'c', assignedToUserId: 'u_a' }),
          ])
        ),
      });

      await findMenus();
      expect(within(metric('Unassigned right now')).getByText('2')).toBeInTheDocument();
    });

    it('does not render until the board has real data — no loading-flicker zero', () => {
      renderPage({ list: vi.fn(() => new Promise(() => {})) });

      expect(screen.queryByText('Unassigned right now')).not.toBeInTheDocument();
    });

    it('counts the packers the roster reports as at their benches', async () => {
      renderPage({
        list: vi.fn().mockResolvedValue(page([task({ id: 'a', assignedToUserId: null })])),
        listPackers: vi.fn().mockResolvedValue({
          packers: [
            { id: 'u_a', username: 'packer-a', online: true, stationLabel: 'Bench 1' },
            { id: 'u_b', username: 'packer-b', online: false, stationLabel: null },
            { id: 'u_c', username: 'packer-c', online: true, stationLabel: null },
          ],
        }),
      });

      await screen.findByText('Packers at their benches');
      await waitFor(() => {
        expect(within(metric('Packers at their benches')).getByText('2')).toBeInTheDocument();
      });
    });

    it('says "not known" rather than zero when the roster could not be read', async () => {
      renderPage({
        list: vi.fn().mockResolvedValue(page([task({ id: 'a', assignedToUserId: null })])),
        listPackers: vi.fn().mockRejectedValue(new Error('roster is down')),
      });

      await screen.findByText('Packers at their benches');
      await waitFor(() => {
        expect(within(metric('Packers at their benches')).getByLabelText('Not known')).toBeInTheDocument();
      });
      expect(within(metric('Packers at their benches')).queryByText('0')).not.toBeInTheDocument();
    });
  });

  describe('drag-and-drop lane reassignment', () => {
    /** A minimal `DataTransfer` stub — happy-dom does not implement one. */
    function fakeDataTransfer(): DataTransfer {
      return { setData: vi.fn(), effectAllowed: '' } as unknown as DataTransfer;
    }

    function draggableRow(): HTMLElement {
      return within(board()).getByText('ol_work_1').closest('li') as HTMLElement;
    }

    it('dragging a task onto a different lane posts the same assignment the menu uses', async () => {
      const { updateAssignment } = renderPage({
        listPackers: vi.fn().mockResolvedValue({
          packers: [
            { id: 'u_a', username: 'packer-a' },
            { id: 'u_b', username: 'packer-b' },
          ],
        }),
      });

      await findMenus();
      const destinationLane = screen.getByRole('region', { name: 'packer-a' });
      fireEvent.dragStart(draggableRow(), { dataTransfer: fakeDataTransfer() });
      fireEvent.dragOver(destinationLane, { dataTransfer: fakeDataTransfer() });
      fireEvent.drop(destinationLane, { dataTransfer: fakeDataTransfer() });

      await waitFor(() => {
        expect(updateAssignment).toHaveBeenCalledWith('ol_work_1', {
          assignedToUserId: 'u_a',
          expectedVersion: 1,
        });
      });
    });

    it("dropping onto the task's own current lane is a no-op", async () => {
      const { updateAssignment } = renderPage({
        list: vi.fn().mockResolvedValue(page([task({ assignedToUserId: 'u_a' })])),
      });

      await findMenus();
      const ownLane = screen.getByRole('region', { name: 'packer-a' });
      fireEvent.dragStart(draggableRow(), { dataTransfer: fakeDataTransfer() });
      fireEvent.dragOver(ownLane, { dataTransfer: fakeDataTransfer() });
      fireEvent.drop(ownLane, { dataTransfer: fakeDataTransfer() });

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(updateAssignment).not.toHaveBeenCalled();
    });

    it('marks the row draggable only for a session that may write', async () => {
      renderPage({});

      await findMenus();
      expect(draggableRow()).toHaveAttribute('draggable', 'true');
    });
  });
});

describe('the merged screen — empty states are three, not one', () => {
  it('says "no matches" when a filter is narrowing the board', async () => {
    renderPage({ list: vi.fn().mockResolvedValue(page([])), route: '/fulfillment?orderId=ol_order_missing' });

    expect(await screen.findByText('No fulfilment tasks match these filters')).toBeInTheDocument();
  });

  it('says "nothing on this page" when paged past the end', async () => {
    renderPage({
      list: vi.fn().mockResolvedValue(page([], { total: 40, offset: 100 })),
      route: '/fulfillment?offset=100',
    });

    expect(await screen.findByText('Nothing on this page')).toBeInTheDocument();
  });

  it('offers a way out of the filtered empty state', async () => {
    renderPage({ list: vi.fn().mockResolvedValue(page([])), route: '/fulfillment?orderId=ol_order_missing' });

    await screen.findByText('No fulfilment tasks match these filters');
    expect(screen.getAllByRole('button', { name: 'Clear filters' }).length).toBeGreaterThan(0);
  });
});

describe('the merged screen — paging (#3096: ListPagination)', () => {
  it('should render the shared pager with the total the server reported', async () => {
    renderPage({ list: vi.fn().mockResolvedValue(page([task()], { total: 60, limit: 25, offset: 0 })) });

    const pager = await screen.findByRole('navigation', { name: 'Pagination' });
    expect(pager.textContent).toContain('of 60');
    expect(within(pager).getByRole('button', { name: 'Next' })).toBeEnabled();
    expect(within(pager).getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  it('asks for the page size the server will actually give', async () => {
    const { list } = renderPage({});

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ limit: 25, offset: 0 }));
    });
  });

  it('should state once that a lane holds only this page, when there is more than one page', async () => {
    renderPage({
      list: vi.fn().mockResolvedValue(
        page([task({ id: 'a', assignedToUserId: 'u_a' }), task({ id: 'b' })], { total: 60 })
      ),
    });

    expect(await screen.findAllByText('Grouped from the tasks on this page only.')).toHaveLength(1);
  });

  it('should say nothing about page scope when everything fits on one page', async () => {
    renderPage({ list: vi.fn().mockResolvedValue(page([task({ id: 'a' }), task({ id: 'b' })])) });

    await findMenus();
    expect(screen.queryByText('Grouped from the tasks on this page only.')).not.toBeInTheDocument();
  });
});

describe('the merged screen — the grouping axis', () => {
  it('groups by packer by default', async () => {
    renderPage({ list: vi.fn().mockResolvedValue(page([task({ assignedToUserId: 'u_a' })])) });

    expect(await screen.findByRole('region', { name: 'packer-a' })).toBeInTheDocument();
  });

  it('should not offer the location axis on a one-location install (#3096)', async () => {
    renderPage({});

    await findMenus();
    expect(screen.queryByRole('radio', { name: 'Location' })).not.toBeInTheDocument();
  });

  it('should ignore ?groupBy=location on a one-location install (#3096)', async () => {
    renderPage({
      list: vi.fn().mockResolvedValue(page([task({ assignedToUserId: 'u_a' })])),
      route: '/fulfillment?groupBy=location',
    });

    expect(await screen.findByRole('region', { name: 'packer-a' })).toBeInTheDocument();
  });

  it('groups by location and delivery method when asked on a multi-location install', async () => {
    renderPage({
      list: vi.fn().mockResolvedValue(page([task({ locationId: 'loc_warsaw' })])),
      route: '/fulfillment?groupBy=location',
      activeLocations: 2,
    });

    expect(await screen.findByRole('region', { name: 'loc_warsaw · courier' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'packer-a' })).not.toBeInTheDocument();
  });

  it('turns drag OFF on the location axis, because a lane id is not a user id', async () => {
    renderPage({
      list: vi.fn().mockResolvedValue(page([task({ locationId: 'loc_warsaw' })])),
      route: '/fulfillment?groupBy=location',
      activeLocations: 2,
    });

    await screen.findByRole('region', { name: 'loc_warsaw · courier' });
    const card = document.querySelector('[data-testid="assign-packing-work-card"]');
    expect(card?.getAttribute('draggable')).not.toBe('true');
  });

  it('counts unassigned tasks on EITHER axis', async () => {
    renderPage({
      list: vi.fn().mockResolvedValue(page([task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })])),
      route: '/fulfillment?groupBy=location',
      activeLocations: 2,
    });

    await screen.findByRole('region', { name: 'loc_warsaw · courier' });
    const metric = document.querySelector('.assign-packing-work-metrics') as HTMLElement;
    expect(within(metric).getByText('3')).toBeInTheDocument();
  });

  it('says why drag is unavailable rather than letting it silently stop working', async () => {
    renderPage({
      list: vi.fn().mockResolvedValue(page([task({ locationId: 'loc_warsaw' })])),
      route: '/fulfillment?groupBy=location',
      activeLocations: 2,
    });

    expect(
      await screen.findByText('Drag moves a task between packers — switch to Packer to use it.')
    ).toBeInTheDocument();
  });

  it('drops the offset when the axis changes', async () => {
    const user = userEvent.setup();
    const { list } = renderPage({
      list: vi.fn().mockResolvedValue(page([task()], { total: 90, offset: 25 })),
      route: '/fulfillment?offset=25',
      activeLocations: 2,
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

describe('the merged screen — the order filter', () => {
  it('sends the order filter read out of the URL, and ignores a legacy locationId (#3096)', async () => {
    const { list } = renderPage({ route: '/fulfillment?orderId=ol_order_7&locationId=loc_krakow' });

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'ol_order_7' }));
    });
    expect(list.mock.calls[0][0]).not.toHaveProperty('locationId');
  });

  it('should offer one filter box, for the order, and no location box (#3096)', async () => {
    renderPage({});

    expect(await screen.findByLabelText('Order')).toBeInTheDocument();
    expect(screen.queryByLabelText('Location')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/location id/i)).not.toBeInTheDocument();
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
    const user = userEvent.setup();
    renderPage({ list: vi.fn().mockResolvedValue(page([])), route: '/fulfillment?orderId=ol_order_7' });

    const before = await screen.findByLabelText<HTMLInputElement>('Order');
    expect(before.value).toBe('ol_order_7');

    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);

    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Order').value).toBe('');
    });
  });

  it('does not send a present-but-empty filter as a value', async () => {
    const { list } = renderPage({ route: '/fulfillment?orderId=' });

    await waitFor(() => {
      expect(list).toHaveBeenCalledTimes(1);
    });
    expect(list.mock.calls[0][0]).not.toHaveProperty('orderId', '');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });
});
