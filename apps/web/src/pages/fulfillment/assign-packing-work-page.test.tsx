/**
 * `AssignPackingWorkPage` (#3340, ADR-074).
 *
 * Covers what would break if the board's assembly regressed: tasks land in
 * the right swimlane, moving a task posts the right body, toggling
 * self-serve posts the right body, and a failed roster read degrades the
 * board rather than blocking it.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
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
});
