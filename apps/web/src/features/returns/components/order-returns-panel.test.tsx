/**
 * Order Returns Panel (#2640)
 *
 * The acceptance criterion this file exists for: **an order with no returns
 * renders a distinguishable empty state** — never a panel implying the read
 * failed, and never an absent panel implying the order cannot have returns. So
 * the four states are asserted as four DIFFERENT surfaces, not as "something
 * rendered".
 *
 * Mounting is asserted one level up, in `pages/orders/order-detail-page.test.tsx`
 * (docs/lessons.md § "is this MOUNTED?" — a component test renders the component
 * itself and can only prove a counterfactual).
 *
 * @module apps/web/src/features/returns/components
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OrderReturnsPanel } from './order-returns-panel';
import { ORDER_RETURNS_PANEL_COPY as COPY } from '../lib/order-returns-panel.copy';
import { RETURN_RESTOCK_BLOCKED_COPY } from '../lib/restock-blocked.copy';
import type { ReturnListItem } from '../api/returns.types';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';

function item(overrides: Partial<ReturnListItem> = {}): ReturnListItem {
  return {
    id: 'ol_return_1',
    sourceConnectionId: 'conn-1',
    externalReturnId: 'RET-1',
    internalOrderId: 'ol_order_1',
    externalOrderId: 'ORDER-1',
    origin: 'source_ingested',
    bucket: 'attributed',
    rawStatus: 'WAITING_FOR_PARCEL',
    openedAt: '2026-08-01T10:00:00.000Z',
    authorizedAt: null,
    declinedAt: null,
    closedAt: null,
    createdAt: '2026-08-01T11:00:00.000Z',
    updatedAt: '2026-08-01T11:00:00.000Z',
    counters: {
      lineCount: 1,
      notReturnedLineCount: 0,
      quantityAdvised: 2,
      quantityReceived: 0,
      quantityRestocked: 0,
      quantityScrapped: 0,
      notReturnedQuantityAdvised: 0,
    },
    restockBlocked: null,
    ...overrides,
  };
}

function listResult(overrides: Record<string, unknown> = {}) {
  return {
    items: [] as ReturnListItem[],
    total: 0,
    limit: 20,
    offset: 0,
    counts: { total: 0, orphan: 0, attributed: 0 },
    stageCounts: null,
    segmentCounts: null,
    droppedCount: 0,
    envelopeUnreadable: false,
    ...overrides,
  };
}

function renderPanel(
  result: ReturnType<typeof listResult> | Error,
  internalOrderId = 'ol_order_1',
) {
  const apiClient = createMockApiClient();
  const list = vi.fn();
  if (result instanceof Error) {
    list.mockRejectedValue(result);
  } else {
    list.mockResolvedValue(result);
  }
  apiClient.returns.list = list as unknown as typeof apiClient.returns.list;

  renderWithProviders(<OrderReturnsPanel internalOrderId={internalOrderId} />, { apiClient });
  return { list };
}

describe('OrderReturnsPanel', () => {
  it('should scope the read to the order it was given', async () => {
    const { list } = renderPanel(listResult({ items: [item()], total: 1 }));

    await waitFor(() => {
      expect(list).toHaveBeenCalled();
    });
    expect(list).toHaveBeenCalledWith(
      { internalOrderId: 'ol_order_1' },
      expect.objectContaining({ offset: 0 }),
    );
  });

  it('should ask NOTHING when it has no order id, and claim nothing either', async () => {
    // `buildQuery` omits a falsy filter, so an issued request would return every
    // return in the installation under this order's heading.
    const { list } = renderPanel(listResult(), '');

    expect(await screen.findByText(COPY.unscopedTitle)).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
    // And specifically NOT the confirmed-empty claim.
    expect(screen.queryByText(COPY.emptyTitle)).not.toBeInTheDocument();
  });

  it('should render a confirmed-empty state when the read answered zero', async () => {
    renderPanel(listResult());

    expect(await screen.findByText(COPY.emptyTitle)).toBeInTheDocument();
    expect(screen.queryByText(COPY.errorTitle)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.unreadableTitle)).not.toBeInTheDocument();
  });

  it('should render a FAILED read as a failure, never as an empty order', async () => {
    renderPanel(new Error('network down'));

    expect(await screen.findByText(COPY.errorTitle)).toBeInTheDocument();
    // The distinguishability criterion, stated as an assertion.
    expect(screen.queryByText(COPY.emptyTitle)).not.toBeInTheDocument();
  });

  it('should render an unreadable envelope distinctly from both', async () => {
    renderPanel(listResult({ envelopeUnreadable: true }));

    expect(await screen.findByText(COPY.unreadableTitle)).toBeInTheDocument();
    expect(screen.queryByText(COPY.emptyTitle)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.errorTitle)).not.toBeInTheDocument();
  });

  it('should render the restock-blocked badge, with the shared sentence', async () => {
    renderPanel(listResult({ items: [item({ restockBlocked: true })], total: 1 }));

    expect(await screen.findByText(RETURN_RESTOCK_BLOCKED_COPY.badge)).toBeInTheDocument();
  });

  it('should render NO badge when the flag was not reported', async () => {
    // `null` means not reported. A badge there would invent an alarm; `false`
    // means the return genuinely has none.
    renderPanel(listResult({ items: [item({ restockBlocked: null })], total: 1 }));

    expect(await screen.findByRole('link', { name: 'RET-1' })).toBeInTheDocument();
    expect(screen.queryByText(RETURN_RESTOCK_BLOCKED_COPY.badge)).not.toBeInTheDocument();
  });

  it('should disclose a genuinely truncated page with both numbers', async () => {
    // Truncation is a PAGE-SIZE fact: `total` past the panel's own page size.
    renderPanel(listResult({ items: [item()], total: 25 }));

    expect(await screen.findByText(COPY.truncated(1, 25))).toBeInTheDocument();
  });

  it('should NOT call an unreadable row a truncated page', async () => {
    // `parseReturnList` excludes an unreadable row from `items` and counts it
    // in `droppedCount`, so gating truncation on the item count would report
    // the same row twice — once as unreadable, once as a page limit that was
    // never reached.
    renderPanel(listResult({ items: [item()], total: 2, droppedCount: 1 }));

    expect(await screen.findByText(/could not be read/i)).toBeInTheDocument();
    expect(screen.queryByText(COPY.truncated(1, 2))).not.toBeInTheDocument();
  });

  it('should report rows it could not read rather than dropping them silently', async () => {
    renderPanel(listResult({ items: [item()], total: 1, droppedCount: 2 }));

    expect(await screen.findByText(/could not be read/i)).toBeInTheDocument();
  });
});
