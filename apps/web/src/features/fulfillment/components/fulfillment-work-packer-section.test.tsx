/**
 * `FulfillmentWorkPackerSection` — the task detail's Packer card (#3096).
 *
 * The card states who packs the parcel (or that nobody does, and for how
 * long), and staffs it with the board's own controls and runner: the same
 * body, the same rendered-version token, the same toasts.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FulfillmentWorkPackerSection } from './fulfillment-work-packer-section';
import { ApiError } from '../../../shared/api/api-error';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { FulfillmentTask } from '../api/fulfillment.types';

afterEach(cleanup);

function task(overrides: Partial<FulfillmentTask> = {}): FulfillmentTask {
  return {
    id: 'ol_fwork_1',
    orderId: 'ol_order_1',
    locationId: null,
    deliveryMethod: null,
    assignedConnectionId: null,
    assignedToUserId: null,
    unassignedSince: null,
    selfServeEligible: true,
    status: 'open',
    requestStatus: 'accepted',
    assignmentAttempt: 0,
    cancellationReason: null,
    externalWorkId: null,
    acceptedAt: null,
    cancelledAt: null,
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
    lines: [],
    activeHolds: [],
    supportedActions: [],
    version: 5,
    ...overrides,
  };
}

const PACKERS = {
  packers: [
    { id: 'u_marta', username: 'Marta Kowalczyk', online: true, stationLabel: 'Bench 3' },
    { id: 'u_bartek', username: 'Bartek Wilk', online: false, stationLabel: null },
  ],
};

function renderCard(opts: {
  task?: FulfillmentTask;
  listPackers?: ReturnType<typeof vi.fn>;
  updateAssignment?: ReturnType<typeof vi.fn>;
  canStaff?: boolean;
}): { updateAssignment: ReturnType<typeof vi.fn> } {
  const updateAssignment = opts.updateAssignment ?? vi.fn().mockResolvedValue(task());
  renderWithProviders(
    <FulfillmentWorkPackerSection task={opts.task ?? task()} canStaff={opts.canStaff ?? true} readOnly={false} />,
    {
      apiClient: createMockApiClient({
        users: { listPackers: opts.listPackers ?? vi.fn().mockResolvedValue(PACKERS) } as never,
        fulfillment: { updateAssignment } as never,
      }),
    }
  );
  return { updateAssignment };
}

function card(): HTMLElement {
  return screen.getByRole('region', { name: 'Packer' });
}

describe('FulfillmentWorkPackerSection', () => {
  it('should render as a detail card titled Packer', () => {
    renderCard({});

    expect(card()).toHaveClass('detail-card');
    expect(within(card()).getByRole('heading', { name: 'Packer' })).toBeInTheDocument();
  });

  it('should say Unassigned and how long it has waited when nobody packs the task', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    renderCard({ task: task({ unassignedSince: twoDaysAgo }) });

    expect(within(card()).getByText('Unassigned')).toBeInTheDocument();
    expect(within(card()).getByText(/^waiting 2d$/)).toBeInTheDocument();
    expect(within(card()).getByRole('button', { name: 'Assign to…' })).toBeInTheDocument();
  });

  it('should name the packer with initials, station and presence when the task is assigned', async () => {
    renderCard({ task: task({ assignedToUserId: 'u_marta' }) });

    expect(await within(card()).findByText('Marta Kowalczyk')).toBeInTheDocument();
    expect(within(card()).getByText('MK')).toBeInTheDocument();
    expect(within(card()).getByText('Bench 3 · online')).toBeInTheDocument();
    expect(within(card()).getByRole('button', { name: 'Move to…' })).toBeInTheDocument();
  });

  it('should say the assignee is no longer a packer when they left the roster', async () => {
    renderCard({ task: task({ assignedToUserId: 'u_gone' }) });

    expect(await within(card()).findByText('No longer a packer')).toBeInTheDocument();
  });

  it('should assign through the board runner, with the version the card rendered', async () => {
    const user = userEvent.setup();
    const { updateAssignment } = renderCard({});

    await user.click(within(card()).getByRole('button', { name: 'Assign to…' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Marta Kowalczyk' }));

    await waitFor(() => {
      expect(updateAssignment).toHaveBeenCalledWith('ol_fwork_1', {
        assignedToUserId: 'u_marta',
        expectedVersion: 5,
      });
    });
    expect(await screen.findByText('Task moved.')).toBeInTheDocument();
  });

  it('should list packers without queue counts, since the detail has no page to count', async () => {
    const user = userEvent.setup();
    renderCard({});

    await user.click(within(card()).getByRole('button', { name: 'Assign to…' }));

    expect(await screen.findByRole('menuitem', { name: 'Bartek Wilk' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /\(\d+\)/ })).not.toBeInTheDocument();
  });

  it('should pull an assigned task back to the pool when asked', async () => {
    const user = userEvent.setup();
    const { updateAssignment } = renderCard({ task: task({ assignedToUserId: 'u_marta' }) });

    await user.click(await within(card()).findByRole('button', { name: 'Move to…' }));
    await user.click(await screen.findByRole('menuitem', { name: /Pull back to Unassigned/ }));

    await waitFor(() => {
      expect(updateAssignment).toHaveBeenCalledWith('ol_fwork_1', {
        assignedToUserId: null,
        expectedVersion: 5,
      });
    });
  });

  it('should toggle self-serve on its own, with its own toast', async () => {
    const user = userEvent.setup();
    const { updateAssignment } = renderCard({});

    await user.click(within(card()).getByRole('checkbox', { name: 'Anyone can pick this up' }));

    await waitFor(() => {
      expect(updateAssignment).toHaveBeenCalledWith('ol_fwork_1', {
        selfServeEligible: false,
        expectedVersion: 5,
      });
    });
    expect(await screen.findByText('Self-serve eligibility updated.')).toBeInTheDocument();
  });

  it('should say somebody changed it first on a 409', async () => {
    const user = userEvent.setup();
    renderCard({ updateAssignment: vi.fn().mockRejectedValue(new ApiError('stale', 409, null)) });

    await user.click(within(card()).getByRole('checkbox', { name: 'Anyone can pick this up' }));

    expect(
      await screen.findByText('Somebody changed this task first. The board has been refreshed.')
    ).toBeInTheDocument();
  });

  it('should degrade with a stated reason when the roster cannot be read', async () => {
    renderCard({ listPackers: vi.fn().mockRejectedValue(new Error('down')) });

    expect(
      await within(card()).findByText(
        'The packer roster could not be loaded, so this task can only be left unassigned.'
      )
    ).toBeInTheDocument();
  });

  it('should be read-only, with no controls, for a session that cannot staff', () => {
    renderCard({ canStaff: false });

    expect(within(card()).getByText('Unassigned')).toBeInTheDocument();
    expect(within(card()).queryByRole('button')).not.toBeInTheDocument();
    expect(within(card()).queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
