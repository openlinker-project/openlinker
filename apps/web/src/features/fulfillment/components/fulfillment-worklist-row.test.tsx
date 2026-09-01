/**
 * `FulfillmentWorklistRow` — AC1, "no client-side state machine" (#2410).
 *
 * `scripts/check-no-supported-actions-mirror.mjs` catches a `derive*` or a
 * `FulfillmentWorkAction[Values]` declaration and says in its own docblock that
 * it cannot catch an inline `if (status === 'open')`. #2411 already specs
 * `FulfillmentTaskActions` itself, so the property is true of that component.
 * What is NOT covered anywhere else is what the WORKLIST ROW selects to hand it
 * — the only place in this body a legality decision could be reintroduced — so
 * every assertion below is written against the row rather than the component.
 *
 * Each case asserts a NON-EMPTY baseline control list first. Comparing two
 * empty arrays is exactly the shape of a check that cannot fail, and is what a
 * `supportedActions: []` fixture — or a `visible: false` typo — would produce.
 */
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FulfillmentWorklistRow } from './fulfillment-worklist-row';
import { FulfillmentTaskActions } from './fulfillment-task-actions';
import { renderWithProviders } from '../../../test/test-utils';
import type { FulfillmentTask } from '../api/fulfillment.types';

afterEach(cleanup);

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
        fulfilledQuantity: 0,
        cancelledQuantity: 0,
      },
    ],
    activeHolds: [],
    supportedActions: ['hold', 'close'],
    version: 7,
    ...overrides,
  };
}

/** Renders the row exactly as the page composes it. */
function renderRow(
  subject: FulfillmentTask,
  access: { visible?: boolean; readOnly?: boolean } = {}
): HTMLElement {
  const { container } = renderWithProviders(
    <ul>
      <FulfillmentWorklistRow
        task={subject}
        actions={
          <FulfillmentTaskActions
            task={subject}
            visible={access.visible ?? true}
            readOnly={access.readOnly ?? false}
            busy={false}
            onInvoke={vi.fn()}
            onHold={vi.fn()}
            onReleaseHold={vi.fn()}
            onForceCancel={vi.fn()}
          />
        }
      />
    </ul>
  );
  return container.querySelector('li') as HTMLElement;
}

function controlLabels(row: HTMLElement): string[] {
  return within(row)
    .queryAllByRole('button')
    .map((button) => button.textContent?.trim() ?? '');
}

describe('FulfillmentWorklistRow — actions come only from supportedActions', () => {
  it('renders the same controls for two tasks that differ only in status', () => {
    // The break this catches: `if (task.status !== 'open') return null;` around
    // the row's action strip.
    const open = renderRow(task({ status: 'open', requestStatus: 'unsubmitted' }));
    const baseline = controlLabels(open);
    expect(baseline.length).toBeGreaterThan(0);

    cleanup();

    const inProgress = renderRow(
      task({ status: 'in_progress', requestStatus: 'accepted' })
    );
    expect(controlLabels(inProgress)).toEqual(baseline);
  });

  it('renders the same controls for two tasks that differ only in a line counter', () => {
    // Counters are display-only (#2400 moves them without bumping `version`),
    // so nothing may be gated on one.
    const untouched = renderRow(task());
    const baseline = controlLabels(untouched);
    expect(baseline.length).toBeGreaterThan(0);

    cleanup();

    const partlyPicked = renderRow(
      task({
        lines: [
          {
            id: 'line_1',
            orderLineId: 'ol_orderline_1',
            productVariantId: 'ol_variant_1',
            totalQuantity: 5,
            fulfilledQuantity: 5,
            cancelledQuantity: 0,
          },
        ],
      })
    );
    expect(controlLabels(partlyPicked)).toEqual(baseline);
  });

  it('still offers hold on a task that already carries one', () => {
    // The plausible row-level defect the two cases above miss: filtering `hold`
    // out because the task is already held is a legality decision, and the
    // server is the one that makes it — it simply does not offer `hold` when a
    // second hold is not legal.
    const unheld = renderRow(task());
    const baseline = controlLabels(unheld);
    expect(baseline.length).toBeGreaterThan(0);

    cleanup();

    const held = renderRow(
      task({
        activeHolds: [
          {
            id: 'hold_1',
            reason: 'stock_shortfall',
            note: null,
            placedAt: '2026-08-20T11:00:00.000Z',
          },
        ],
      })
    );
    expect(controlLabels(held)).toEqual(baseline);
  });
});

describe('FulfillmentWorklistRow — write access is the page’s decision', () => {
  it('renders no controls at all for an unauthorized session', () => {
    const authorized = renderRow(task());
    expect(controlLabels(authorized).length).toBeGreaterThan(0);

    cleanup();

    const unauthorized = renderRow(task(), { visible: false });
    expect(controlLabels(unauthorized)).toEqual([]);
  });

  it('renders the same controls DISABLED, not hidden, in demo read-only', () => {
    // #1615: a public demo advertises the capability rather than hiding it, so
    // hiding on read-only is the regression this pins.
    const writable = renderRow(task());
    const baseline = controlLabels(writable);
    expect(baseline.length).toBeGreaterThan(0);

    cleanup();

    const readOnly = renderRow(task(), { readOnly: true });
    expect(controlLabels(readOnly)).toEqual(baseline);
    for (const button of within(readOnly).getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });
});

describe('FulfillmentWorklistRow — what it shows', () => {
  it('leads with the hold rather than the orchestration status when held', () => {
    const row = renderRow(
      task({
        status: 'open',
        activeHolds: [
          {
            id: 'hold_1',
            reason: 'stock_shortfall',
            note: null,
            placedAt: '2026-08-20T11:00:00.000Z',
          },
        ],
      })
    );

    // POSITIVE assertion — "does not say Open" would also pass on an empty row.
    // Anchored: an unanchored /on hold/i also matches the "Put on hold" BUTTON,
    // so it would pass on a row that rendered no hold badge at all.
    expect(within(row).getByText(/^On hold —/)).toBeInTheDocument();
    expect(row.dataset.held).toBe('true');
  });

  it('renders the display-only line counter', () => {
    const row = renderRow(
      task({
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
      })
    );

    expect(within(row).getByText('3 of 5')).toBeInTheDocument();
  });

  it('says a task covers no lines rather than rendering an empty counter', () => {
    const row = renderRow(task({ lines: [] }));
    expect(within(row).getByText('No lines')).toBeInTheDocument();
    expect(screen.queryByText('0 of 0')).not.toBeInTheDocument();
  });
});
