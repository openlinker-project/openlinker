/**
 * `useFulfillmentAssignmentRunner` / `staffingFailureMessage` (#3096, moved
 * out of the assign board page; failure wording #3415).
 *
 * The board and the task detail's Packer card both staff a task through this
 * runner, so its failure reading is pinned here once rather than through each
 * page.
 */
import { act, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  staffingFailureMessage,
  useFulfillmentAssignmentRunner,
  type FulfillmentAssignmentRunner,
} from './use-fulfillment-assignment-runner';
import { ApiError } from '../../../shared/api/api-error';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { FulfillmentTask } from '../api/fulfillment.types';
import { ASSIGN_PACKING_WORK_COPY } from '../lib/assign-packing-work.copy';

const ROW = ASSIGN_PACKING_WORK_COPY.row;

describe('staffingFailureMessage', () => {
  it('should tell a refused session it may not reassign when the API answers 403', () => {
    expect(staffingFailureMessage(new ApiError('no', 403, null), true)).toBe(ROW.moveForbidden);
  });

  it('should say the task is gone when the API answers 404', () => {
    expect(staffingFailureMessage(new ApiError('gone', 404, null), true)).toBe(ROW.moveNotFound);
  });

  it('should say somebody got there first when the API answers 409', () => {
    expect(staffingFailureMessage(new ApiError('stale', 409, null), false)).toBe(ROW.moveConflict);
  });

  it('should not claim nothing changed when the outcome is unknown', () => {
    expect(staffingFailureMessage(new ApiError('boom', 500, null), true)).toBe(ROW.moveUnknown);
    expect(staffingFailureMessage(new Error('dropped'), true)).toBe(ROW.moveUnknown);
  });

  it('should word a refused move and a refused self-serve toggle differently', () => {
    expect(staffingFailureMessage(new ApiError('bad', 400, null), true)).toBe(ROW.moveFailed);
    expect(staffingFailureMessage(new ApiError('bad', 400, null), false)).toBe(ROW.selfServeFailed);
  });
});

function task(overrides: Partial<FulfillmentTask> = {}): FulfillmentTask {
  return {
    id: 'ol_fwork_1',
    orderId: 'ol_order_1',
    locationId: null,
    deliveryMethod: null,
    assignedConnectionId: null,
    assignedToUserId: null,
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
    version: 9,
    ...overrides,
  };
}

describe('useFulfillmentAssignmentRunner', () => {
  it('should send the rendered version and mark the task busy until the write settles', async () => {
    let settle: (value: FulfillmentTask) => void = () => {};
    const updateAssignment = vi.fn(
      () =>
        new Promise<FulfillmentTask>((resolve) => {
          settle = resolve;
        })
    );
    const apiClient = createMockApiClient({ fulfillment: { updateAssignment } as never });

    // A holder object rather than a reassigned `let`: TypeScript does not
    // track an assignment made inside the component function, and would
    // narrow a `let` to `null` at every use below.
    const captured: { current: FulfillmentAssignmentRunner | null } = { current: null };
    function Probe(): ReactElement | null {
      captured.current = useFulfillmentAssignmentRunner();
      return null;
    }
    renderWithProviders(<Probe />, { apiClient });

    await waitFor(() => {
      expect(captured.current).not.toBeNull();
    });
    act(() => {
      captured.current?.setAssignment(task(), { assignedToUserId: 'u_a' });
    });

    await waitFor(() => {
      expect(updateAssignment).toHaveBeenCalledWith('ol_fwork_1', {
        assignedToUserId: 'u_a',
        expectedVersion: 9,
      });
    });
    expect(captured.current?.busyTaskId).toBe('ol_fwork_1');

    act(() => {
      settle(task());
    });
    await waitFor(() => {
      expect(captured.current?.busyTaskId).toBeNull();
    });
  });
});
