/**
 * Orphan Returns Worklist (#3078/#3081, plus #3083's inline authorize wiring)
 *
 * The acceptance criteria this file exists for: orphan and pending-approval
 * returns render in two distinct, labelled groups, each row has exactly one
 * primary action, and — #3083's own criterion — confirming the approve
 * dialog removes the row from the pending-approval group. Mounting on a real
 * page is asserted one level up, wherever #3085 places the entry point
 * (docs/lessons.md § "is this MOUNTED?").
 *
 * @module apps/web/src/features/returns/components
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrphanReturnsWorklist } from './orphan-returns-worklist';
import { ORPHAN_RETURNS_WORKLIST_COPY as COPY } from '../lib/orphan-returns-worklist.copy';
import { AUTHORIZE_RETURN_DIALOG_COPY } from '../lib/authorize-return-dialog.copy';
import type { ReturnListItem } from '../api/returns.types';
import { createNoopSessionAdapter } from '../../../shared/auth/noop-session-adapter';
import type { SessionAdapter } from '../../../shared/auth/session-adapter';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';

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

/**
 * One mock, two behaviours keyed on the `bucket` filter each query passes.
 *
 * Defaults to an `orders:write`-holding session (`createAuthenticatedSessionAdapter()`
 * grants every permission), so every pre-existing test in this file keeps
 * exercising the "Approve" button as it did before the write-access gate
 * (#3283) — the gate's own negative case passes a permission-less session
 * explicitly instead.
 */
function renderWorklist(options: {
  needsOrder?: ReturnType<typeof listResult> | Error;
  needsApproval?: ReturnType<typeof listResult> | Error;
  sessionAdapter?: SessionAdapter;
  demoMode?: boolean;
}) {
  const apiClient = createMockApiClient();
  const list = vi.fn(async (filters: { bucket?: string } = {}) => {
    const result = filters.bucket === 'orphan' ? options.needsOrder : options.needsApproval;
    if (result instanceof Error) throw result;
    return result ?? listResult();
  });
  apiClient.returns.list = list as unknown as typeof apiClient.returns.list;
  if (options.demoMode !== undefined) {
    apiClient.system.getConfig = vi
      .fn()
      .mockResolvedValue({ demoMode: options.demoMode }) as unknown as typeof apiClient.system.getConfig;
  }

  renderWithProviders(<OrphanReturnsWorklist />, {
    apiClient,
    sessionAdapter: options.sessionAdapter ?? createAuthenticatedSessionAdapter(),
  });
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

    // A BUTTON, not a link (#3083) — this write carries no form, so its
    // primary action opens the authorize dialog inline rather than routing
    // to a detail-page destination.
    expect(await screen.findByRole('button', { name: COPY.needsApprovalAction })).toBeInTheDocument();
  });

  it('should hide the Approve button for a session with no write permission, and fall back to the detail Link (#3283)', async () => {
    // `POST /returns/:returnId/authorize` is `@Roles('admin', 'operator')` —
    // an enabled button for a `viewer`/`packer` session answers 403, which
    // this dialog would then render as an unactionable "try again". Hidden
    // entirely is the `return-decline-action.tsx` precedent for a session
    // with no write access and no demo carve-out.
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
      sessionAdapter: createNoopSessionAdapter(),
    });

    // The row action falls back to the ordinary detail Link rather than
    // vanishing entirely — navigation to a read surface needs no gate.
    expect(await screen.findByRole('link', { name: COPY.needsApprovalAction })).toHaveAttribute(
      'href',
      '/returns/r2',
    );
    expect(screen.queryByRole('button', { name: COPY.needsApprovalAction })).not.toBeInTheDocument();
  });

  it('should render the Approve button DISABLED behind a ReadOnlyLock for a demo viewer with no write permission (#3283)', async () => {
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
      sessionAdapter: createNoopSessionAdapter(),
      demoMode: true,
    });

    // `visible = canWrite || demoReadOnly`, so a demo viewer sees the WRITE
    // affordance (never the read-only Link fallback) but cannot use it — the
    // #1615 "advertise, don't hide" rule `return-decline-action.tsx` follows.
    const action = await screen.findByRole('button', { name: COPY.needsApprovalAction });
    expect(action).toBeDisabled();
    expect(action.closest('.read-only-lock')).not.toBeNull();
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
        total: 150,
        limit: 100,
      }),
    });

    expect(await screen.findByText(COPY.approvalScanTruncated)).toBeInTheDocument();
  });

  it('should NOT disclose truncation for the approval scan when total is within the page ceiling', async () => {
    // total: 40 with only one row surviving the client-side origin/authorizedAt
    // filter must not be read as "40 - 1 more past the boundary" — the gate is
    // the page-size ceiling (100), never the item/result-items count.
    renderWorklist({
      needsOrder: listResult(),
      needsApproval: listResult({
        items: [item({ id: 'r5b', bucket: 'attributed', origin: 'operator_authored', authorizedAt: null })],
        total: 40,
        limit: 100,
      }),
    });

    await screen.findByRole('link', { name: COPY.needsApprovalAction });
    expect(screen.queryByText(COPY.approvalScanTruncated)).not.toBeInTheDocument();
  });

  it('should render the truncation caveat INSTEAD OF a confirmed-empty claim when the scan was truncated and nothing survived the client-side filter', async () => {
    // Guards the BLOCKING finding on #3280: a truncated page whose scanned
    // rows all failed the client-side origin/authorizedAt filter must never
    // render "Nothing is waiting for your approval." — that is a confirmed-empty
    // claim the component is not entitled to make off a partial scan.
    renderWorklist({
      needsOrder: listResult(),
      needsApproval: listResult({
        items: [item({ id: 'r5c', bucket: 'attributed', origin: 'source_ingested', authorizedAt: null })],
        total: 150,
        limit: 100,
      }),
    });

    expect(await screen.findByText(COPY.approvalScanTruncated)).toBeInTheDocument();
    expect(screen.queryByText(COPY.needsApprovalEmpty)).not.toBeInTheDocument();
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

  it('should NOT report a truncated page when total matches drops + shown rows, only the page ceiling', async () => {
    // Regression for the truncation-predicate finding on #3280: a page of 3
    // rows, 2 unparseable, 1 shown — `total: 3` — must never be read as
    // "more rows past the boundary" (it would double-report the same 2 rows
    // as both unreadable AND a page limit that was never reached).
    renderWorklist({
      needsOrder: listResult({
        items: [item({ id: 'r8', externalReturnId: 'RET-8' })],
        total: 3,
        droppedCount: 2,
      }),
      needsApproval: listResult(),
    });

    await screen.findByText(/could not be read and/);
    expect(screen.queryByText(/more are waiting to be matched/)).not.toBeInTheDocument();
  });

  it('should render the dropped-rows notice INSTEAD OF a confirmed-empty claim when every row on the page was unreadable', async () => {
    // Every scanned row failed to parse: `items: []`, `droppedCount > 0`. Must
    // never render "Nothing is waiting to be matched to an order." — an orphan
    // return blocks every downstream trigger, so a false "queue is clear" here
    // is costlier than the same shape on `order-returns-panel.tsx`.
    renderWorklist({
      needsOrder: listResult({ items: [], total: 2, droppedCount: 2 }),
      needsApproval: listResult(),
    });

    expect(await screen.findByText(/could not be read and/)).toBeInTheDocument();
    expect(screen.queryByText(COPY.needsOrderEmpty)).not.toBeInTheDocument();
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

  it('should call authorize and remove the row from the pending-approval group (#3083)', async () => {
    // A stateful list mock, so the refetch `useAuthorizeReturnMutation`
    // triggers on success sees the row gone — exactly what the real backend
    // would report once the write landed.
    let approvalItems: ReturnListItem[] = [
      item({
        id: 'r2',
        externalReturnId: null,
        bucket: 'attributed',
        origin: 'operator_authored',
        internalOrderId: 'ol_order_1',
        authorizedAt: null,
      }),
    ];
    const apiClient = createMockApiClient();
    const list = vi.fn(async (filters: { bucket?: string } = {}) => {
      if (filters.bucket === 'orphan') return listResult();
      return listResult({ items: approvalItems, total: approvalItems.length });
    });
    apiClient.returns.list = list as unknown as typeof apiClient.returns.list;
    const authorize = vi.fn().mockImplementation(async () => {
      approvalItems = [];
      return { outcome: 'authorized', changeId: 'ol_change_1', authorizedAt: '2026-08-01T00:00:00.000Z' };
    });
    apiClient.returns.authorize = authorize as unknown as typeof apiClient.returns.authorize;

    renderWithProviders(<OrphanReturnsWorklist />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await userEvent.click(await screen.findByRole('button', { name: COPY.needsApprovalAction }));
    await userEvent.click(
      await screen.findByRole('button', { name: AUTHORIZE_RETURN_DIALOG_COPY.confirm }),
    );

    await waitFor(() => {
      expect(authorize).toHaveBeenCalledWith('r2');
    });
    await waitFor(() => {
      expect(screen.getByText(COPY.needsApprovalEmpty)).toBeInTheDocument();
    });
  });
});
