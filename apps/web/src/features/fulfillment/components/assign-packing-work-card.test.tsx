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
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssignPackingWorkCard } from './assign-packing-work-card';
import type { FulfillmentTask } from '../api/fulfillment.types';

// The card's reference is a `<Link>` since #3096/#3259 — every render below
// needs a router in scope, and the href is fixed rather than varied per case
// because this suite is about the badge, not the link.
const DETAIL_HREF = '/fulfillment/works/ol_work_1';

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
      <MemoryRouter>
        <AssignPackingWorkCard
          task={task({ unassignedSince: null })}
          actions={null}
          inUnassignedLane
          detailHref={DETAIL_HREF}
        />
      </MemoryRouter>
    );

    expect(screen.queryByText(/Sat unassigned/)).not.toBeInTheDocument();
  });

  it('renders nothing when unassignedSince is undefined (API predates the column)', () => {
    render(
      <MemoryRouter>
        <AssignPackingWorkCard
          task={task({ unassignedSince: undefined })}
          actions={null}
          inUnassignedLane
          detailHref={DETAIL_HREF}
        />
      </MemoryRouter>
    );

    expect(screen.queryByText(/Sat unassigned/)).not.toBeInTheDocument();
  });

  it('renders the compact age when unassignedSince is set and the card is in the unassigned lane', () => {
    render(
      <MemoryRouter>
        <AssignPackingWorkCard
          task={task({ unassignedSince: '2026-06-01T11:08:00.000Z' })}
          actions={null}
          inUnassignedLane
          detailHref={DETAIL_HREF}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('Sat unassigned 52m')).toBeInTheDocument();
  });

  it('never renders outside the unassigned lane, whatever unassignedSince says', () => {
    render(
      <MemoryRouter>
        <AssignPackingWorkCard
          task={task({ unassignedSince: '2026-06-01T11:08:00.000Z' })}
          actions={null}
          inUnassignedLane={false}
          detailHref={DETAIL_HREF}
        />
      </MemoryRouter>
    );

    expect(screen.queryByText(/Sat unassigned/)).not.toBeInTheDocument();
  });

  it('yields to a hold badge', () => {
    render(
      <MemoryRouter>
        <AssignPackingWorkCard
          task={task({
            unassignedSince: '2026-06-01T11:08:00.000Z',
            activeHolds: [{ id: 'hold_1', reason: 'fraud-review', note: null, placedAt: NOW_ISO }],
          })}
          actions={null}
          inUnassignedLane
          detailHref={DETAIL_HREF}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('On hold')).toBeInTheDocument();
    expect(screen.queryByText(/Sat unassigned/)).not.toBeInTheDocument();
  });

  it('yields to a ship-by deadline badge', () => {
    render(
      <MemoryRouter>
        <AssignPackingWorkCard
          task={task({
            unassignedSince: '2026-06-01T11:08:00.000Z',
            dispatchByAt: '2026-06-01T13:00:00.000Z',
          })}
          actions={null}
          inUnassignedLane
          detailHref={DETAIL_HREF}
        />
      </MemoryRouter>
    );

    // `formatShipBy` reads a real Date under the hood, so this only proves
    // precedence rather than a specific label — the deadline text is
    // whatever `formatShipBy` renders relative to the real "now".
    expect(screen.queryByText(/Sat unassigned/)).not.toBeInTheDocument();
  });
});

describe('AssignPackingWorkCard — reference link (#3096/#3259)', () => {
  it('renders the reference as a link to the task detail page', () => {
    render(
      <MemoryRouter>
        <AssignPackingWorkCard task={task()} actions={null} detailHref={DETAIL_HREF} />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: task().id });
    expect(link).toHaveAttribute('href', DETAIL_HREF);
  });

  it('prefers the order reference over the raw id when one is known', () => {
    render(
      <MemoryRouter>
        <AssignPackingWorkCard
          task={task({ orderReference: 'PS-4471' })}
          actions={null}
          detailHref={DETAIL_HREF}
        />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: 'PS-4471' });
    expect(link).toHaveAttribute('href', DETAIL_HREF);
  });

  it('should shorten a UUID-shaped reference head-and-tail and keep the full value in the title', () => {
    render(
      <MemoryRouter>
        <AssignPackingWorkCard
          task={task({ orderReference: '1a7a9550-bd84-11f1-a5f3-e32e252d5e3f' })}
          actions={null}
          detailHref={DETAIL_HREF}
        />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: '1a7a9550…2d5e3f' });
    expect(link).toHaveAttribute('title', '1a7a9550-bd84-11f1-a5f3-e32e252d5e3f');
    // The mockup's ink-coloured reference, not an orange body link.
    expect(link).not.toHaveClass('link');
  });
});

describe('AssignPackingWorkCard — the scan summary (#3096)', () => {
  function lineOf(totalQuantity: number, id: string): FulfillmentTask['lines'][number] {
    return {
      id,
      orderLineId: `o_${id}`,
      productVariantId: `v_${id}`,
      totalQuantity,
      fulfilledQuantity: 0,
      cancelledQuantity: 0,
    };
  }

  it('should say only the product count when every product is a single unit', () => {
    render(
      <MemoryRouter>
        <AssignPackingWorkCard task={task({ lines: [lineOf(1, 'a')] })} actions={null} detailHref={DETAIL_HREF} />
      </MemoryRouter>
    );

    expect(screen.getByText('1 product to scan')).toBeInTheDocument();
  });

  it('should add the unit count when it differs from the product count', () => {
    render(
      <MemoryRouter>
        <AssignPackingWorkCard
          task={task({ lines: [lineOf(3, 'a'), lineOf(1, 'b'), lineOf(1, 'c')] })}
          actions={null}
          detailHref={DETAIL_HREF}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('3 products, 5 units to scan')).toBeInTheDocument();
  });

  it('should leave the location off unless the caller says the install has several', () => {
    const { rerender } = render(
      <MemoryRouter>
        <AssignPackingWorkCard
          task={task({ locationName: 'Main warehouse' })}
          actions={null}
          detailHref={DETAIL_HREF}
        />
      </MemoryRouter>
    );
    expect(screen.queryByText(/Main warehouse/)).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <AssignPackingWorkCard
          task={task({ locationName: 'Main warehouse' })}
          actions={null}
          detailHref={DETAIL_HREF}
          showLocation
        />
      </MemoryRouter>
    );
    expect(screen.getByText(/· Main warehouse/)).toBeInTheDocument();
  });
});
