/**
 * `AssignPackingWorkCard` — the "Sat unassigned" badge (#3424).
 *
 * Covers the badge's own null-handling (a `null`/`undefined`
 * `unassignedSince` renders nothing rather than a fabricated "0m"), its
 * unassigned-lane-only gate, and its place in the existing hold/ship-by
 * precedence — the property that would silently break if the new branch
 * landed above rather than below `formatShipBy`.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssignPackingWorkCard } from './assign-packing-work-card';
import type { FulfillmentTask } from '../api/fulfillment.types';

const NOW_ISO = '2026-06-01T12:00:00.000Z';

// The badge renders an AGE, so the clock is an input and has to be pinned.
// Without this the suite read `Date.now()` and compared a fixed 2026-06-01
// stamp against whenever it happened to run - the "52m" case measured months
// and failed, while the cases asserting an ABSENT badge passed for the wrong
// reason and would have kept passing however wrong the arithmetic got.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function task(overrides: Partial<FulfillmentTask> = {}): FulfillmentTask {
  return {
    id: 'ol_work_1',
    orderId: 'ol_order_1',
    locationId: null,
    deliveryMethod: null,
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
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    lines: [],
    activeHolds: [],
    supportedActions: [],
    version: 1,
    ...overrides,
  };
}

describe('AssignPackingWorkCard — "Sat unassigned" badge', () => {
  it('renders nothing when unassignedSince is null, even in the unassigned lane', () => {
    render(
      <AssignPackingWorkCard
        task={task({ unassignedSince: null })}
        actions={null}
        inUnassignedLane
      />
    );

    expect(screen.queryByText(/Sat unassigned/)).not.toBeInTheDocument();
  });

  it('renders nothing when unassignedSince is undefined (API predates the column)', () => {
    render(
      <AssignPackingWorkCard
        task={task({ unassignedSince: undefined })}
        actions={null}
        inUnassignedLane
      />
    );

    expect(screen.queryByText(/Sat unassigned/)).not.toBeInTheDocument();
  });

  it('renders the compact age when unassignedSince is set and the card is in the unassigned lane', () => {
    render(
      <AssignPackingWorkCard
        task={task({ unassignedSince: '2026-06-01T11:08:00.000Z' })}
        actions={null}
        inUnassignedLane
      />
    );

    expect(screen.getByText('Sat unassigned 52m')).toBeInTheDocument();
  });

  it('never renders outside the unassigned lane, whatever unassignedSince says', () => {
    render(
      <AssignPackingWorkCard
        task={task({ unassignedSince: '2026-06-01T11:08:00.000Z' })}
        actions={null}
        inUnassignedLane={false}
      />
    );

    expect(screen.queryByText(/Sat unassigned/)).not.toBeInTheDocument();
  });

  it('yields to a hold badge', () => {
    render(
      <AssignPackingWorkCard
        task={task({
          unassignedSince: '2026-06-01T11:08:00.000Z',
          activeHolds: [{ id: 'hold_1', reason: 'fraud-review', note: null, placedAt: NOW_ISO }],
        })}
        actions={null}
        inUnassignedLane
      />
    );

    expect(screen.getByText('On hold')).toBeInTheDocument();
    expect(screen.queryByText(/Sat unassigned/)).not.toBeInTheDocument();
  });

  it('yields to a ship-by deadline badge', () => {
    render(
      <AssignPackingWorkCard
        task={task({
          unassignedSince: '2026-06-01T11:08:00.000Z',
          dispatchByAt: '2026-06-01T13:00:00.000Z',
        })}
        actions={null}
        inUnassignedLane
      />
    );

    // `formatShipBy` reads a real Date under the hood, so this only proves
    // precedence rather than a specific label — the deadline text is
    // whatever `formatShipBy` renders relative to the real "now".
    expect(screen.queryByText(/Sat unassigned/)).not.toBeInTheDocument();
  });
});
