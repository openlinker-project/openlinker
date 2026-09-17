/**
 * Orphan Returns Worklist (#3078/#3081)
 *
 * The acceptance criteria this file exists for: orphan and pending-approval
 * returns render in two distinct, labelled groups, and each row has exactly
 * one primary action. Mounting is asserted one level up, wherever #3085
 * places the entry point (docs/lessons.md § "is this MOUNTED?").
 *
 * @module apps/web/src/features/returns/components
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OrphanReturnsWorklist } from './orphan-returns-worklist';
import { ORPHAN_RETURNS_WORKLIST_COPY as COPY } from '../lib/orphan-returns-worklist.copy';
import type { ReturnListItem } from '../api/returns.types';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';

function item(overrides: Partial<ReturnListItem> = {}): ReturnListItem {
  return {
    id: 'ol_return_1',
    sourceConnectionId: 'conn-1',
    externalReturnId: 'RET-1',
    internalOrderId: null,
    externalOrderId: 'ORDER-1',
    origin: 'source_ingested',
    bucket: 'orphan',
    rawStatus: 'RETURNED',
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

/** One mock, two behaviours keyed on the `bucket` filter each query passes. */
function renderWorklist(options: {
  needsOrder?: ReturnType<typeof listResult> | Error;
  needsApproval?: ReturnType<typeof listResult> | Error;
}) {
  const apiClient = createMockApiClient();
  const list = vi.fn(async (filters: { bucket?: string } = {}) => {
    const result = filters.bucket === 'orphan' ? options.needsOrder : options.needsApproval;
    if (result instanceof Error) throw result;
    return result ?? listResult();
  });
  apiClient.returns.list = list as unknown as typeof apiClient.returns.list;

  renderWithProviders(<OrphanReturnsWorklist />, { apiClient });
  return { list };
}

describe('OrphanReturnsWorklist', () => {
  it('should render both groups, distinctly labelled', async () => {
    renderWorklist({
      needsOrder: listResult({ items: [item()], total: 1 }),
      needsApproval: listResult(),
    });

    expect(await screen.findByText(COPY.needsOrderTitle)).toBeInTheDocument();
    expect(screen.getByText(COPY.needsApprovalTitle)).toBeInTheDocument();
  });

  it('should render exactly one primary action per orphan row', async () => {
    renderWorklist({
      needsOrder: listResult({ items: [item({ id: 'r1', externalReturnId: 'RET-1' })], total: 1 }),
      needsApproval: listResult(),
    });

    const action = await screen.findByRole('link', { name: COPY.needsOrderAction });
    expect(action).toHaveAttribute('href', '/returns/r1');
    // Exactly one — not a second link/button competing for the same row.
    expect(screen.getAllByRole('link', { name: COPY.needsOrderAction })).toHaveLength(1);
  });

  it('should surface an operator-authored, unapproved return under "waiting for your OK"', async () => {
    renderWorklist({
      needsOrder: listResult(),
      needsApproval: listResult({
        items: [
          item({
            id: 'r2',
            externalReturnId: null,
            bucket: 'attributed',
            origin: 'operator_authored',
            internalOrderId: 'ol_order_1',
            authorizedAt: null,
          }),
        ],
        total: 1,
      }),
    });

    const action = await screen.findByRole('link', { name: COPY.needsApprovalAction });
    expect(action).toHaveAttribute('href', '/returns/r2');
  });

  it('should EXCLUDE an already-authorized operator-authored return from "waiting for your OK"', async () => {
    renderWorklist({
      needsOrder: listResult(),
      needsApproval: listResult({
        items: [
          item({
            id: 'r3',
            bucket: 'attributed',
            origin: 'operator_authored',
            authorizedAt: '2026-08-02T00:00:00.000Z',
          }),
        ],
        total: 1,
      }),
    });

    await waitFor(() => {
      expect(screen.getByText(COPY.needsApprovalEmpty)).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: COPY.needsApprovalAction })).not.toBeInTheDocument();
  });

  it('should EXCLUDE a source-ingested return from "waiting for your OK", authorized or not', async () => {
    renderWorklist({
      needsOrder: listResult(),
      needsApproval: listResult({
        items: [item({ id: 'r4', bucket: 'attributed', origin: 'source_ingested', authorizedAt: null })],
        total: 1,
      }),
    });

    await waitFor(() => {
      expect(screen.getByText(COPY.needsApprovalEmpty)).toBeInTheDocument();
    });
  });

  it('should render a confirmed-empty message per group when each answered zero', async () => {
    renderWorklist({ needsOrder: listResult(), needsApproval: listResult() });

    expect(await screen.findByText(COPY.needsOrderEmpty)).toBeInTheDocument();
    expect(screen.getByText(COPY.needsApprovalEmpty)).toBeInTheDocument();
  });

  it('should render a FAILED read as a failure, never as an empty group', async () => {
    renderWorklist({ needsOrder: new Error('network down'), needsApproval: listResult() });

    expect(await screen.findByText(COPY.errorTitle)).toBeInTheDocument();
    expect(screen.queryByText(COPY.needsOrderEmpty)).not.toBeInTheDocument();
  });

  it('should render an unreadable envelope distinctly from an empty group', async () => {
    renderWorklist({
      needsOrder: listResult({ envelopeUnreadable: true }),
      needsApproval: listResult(),
    });

    expect(await screen.findByText(COPY.unreadableTitle)).toBeInTheDocument();
    expect(screen.queryByText(COPY.needsOrderEmpty)).not.toBeInTheDocument();
  });

  it('should disclose a truncated approval scan rather than trimming quietly', async () => {
    renderWorklist({
      needsOrder: listResult(),
      needsApproval: listResult({
        items: [item({ id: 'r5', bucket: 'attributed', origin: 'operator_authored', authorizedAt: null })],
        total: 40,
        limit: 1,
      }),
    });

    expect(await screen.findByText(COPY.approvalScanTruncated)).toBeInTheDocument();
  });

  it('should disclose a truncated needs-order page with both numbers, never trimming quietly', async () => {
    renderWorklist({
      needsOrder: listResult({
        items: [item({ id: 'r6', externalReturnId: 'RET-6' })],
        total: 45,
        limit: 1,
      }),
      needsApproval: listResult(),
    });

    expect(await screen.findByText(COPY.needsOrderTruncated(1, 45))).toBeInTheDocument();
  });

  it('should disclose rows dropped for being unparseable, separately from a truncated page', async () => {
    renderWorklist({
      needsOrder: listResult({
        items: [item({ id: 'r7', externalReturnId: 'RET-7' })],
        total: 1,
        droppedCount: 2,
      }),
      needsApproval: listResult(),
    });

    expect(await screen.findByText(/could not be read and/)).toBeInTheDocument();
  });

  it('should scope each query by its own bucket filter', async () => {
    const { list } = renderWorklist({ needsOrder: listResult(), needsApproval: listResult() });

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(
        { bucket: 'orphan' },
        expect.objectContaining({ offset: 0 }),
      );
      expect(list).toHaveBeenCalledWith(
        { bucket: 'attributed' },
        expect.objectContaining({ offset: 0 }),
      );
    });
  });
});
