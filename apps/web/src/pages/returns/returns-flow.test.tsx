/**
 * Orphan / manual returns — end-to-end flow tests (#3078/#3086)
 *
 * Every component in this epic (#3079-#3085) already has its own isolated
 * unit tests. What was missing, and what this file exists to close, is a test
 * that drives the REAL sequence an operator goes through — several
 * components composed together, a mutation's success feeding the NEXT read,
 * across a page navigation where the flow crosses one — rather than each
 * piece asserted in isolation against a static fixture.
 *
 * Two flows, matching the epic's two entry points:
 *
 * 1. **Record → appears → approve → disappears**, entirely on the returns
 *    list page. The list's own `apiClient.returns.list` mock is STATEFUL —
 *    each write actually mutates the array the next read serves — because
 *    the property under test is that a real mutation's cache invalidation
 *    (#3080) actually changes what the NEXT render shows, which a mock
 *    returning a fixed fixture cannot exercise.
 * 2. **Orphan → match → order shown**, crossing from the list page (where the
 *    worklist's `Link` lives, #3081) to the detail page (where the dialog now
 *    lives, #3085) via a REAL `react-router` navigation — both routes are
 *    mounted together, so clicking the link is a genuine click-through, not a
 *    `route:` prop pointed straight at the destination.
 *
 * @module apps/web/src/pages/returns
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import {
  AUTHORIZE_RETURN_DIALOG_COPY,
  MATCH_RETURN_DIALOG_COPY,
  ORPHAN_RETURNS_WORKLIST_COPY,
  RECORD_RETURN_DIALOG_COPY,
  RETURN_ORPHAN_BANNER_COPY,
  type ReturnDetail,
  type ReturnListItem,
} from '../../features/returns';
import type { OrderRecord } from '../../features/orders';
import type { Connection } from '../../features/connections/api/connections.types';
import { ReturnsListPage } from './returns-list-page';
import { ReturnDetailPage } from './return-detail-page';

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn_1',
    name: 'Allegro Main',
    platformType: 'allegro',
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: [],
    supportedCapabilities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    internalOrderId: 'ol_order_1',
    customerId: null,
    sourceConnectionId: 'conn_1',
    sourceEventId: null,
    orderSnapshot: {},
    syncStatus: [],
    syncAttempts: [],
    recordStatus: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function listItem(overrides: Partial<ReturnListItem> = {}): ReturnListItem {
  return {
    id: 'ol_return_1',
    sourceConnectionId: 'conn_1',
    externalReturnId: null,
    internalOrderId: null,
    externalOrderId: null,
    origin: 'operator_authored',
    bucket: 'attributed',
    rawStatus: null,
    openedAt: '2026-08-01T00:00:00.000Z',
    authorizedAt: null,
    declinedAt: null,
    closedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    counters: {
      lineCount: 1,
      notReturnedLineCount: 0,
      quantityAdvised: 1,
      quantityReceived: 0,
      quantityRestocked: 0,
      quantityScrapped: 0,
      notReturnedQuantityAdvised: 0,
    },
    restockBlocked: null,
    ...overrides,
  };
}

function listResult(items: ReturnListItem[]) {
  return {
    items,
    total: items.length,
    limit: 20,
    offset: 0,
    counts: { total: items.length, orphan: 0, attributed: items.length },
    stageCounts: null,
    segmentCounts: null,
    droppedCount: 0,
    envelopeUnreadable: false,
  };
}

describe('returns flows (#3078/#3086)', () => {
  afterEach(cleanup);

  it('should record a return, see it in the worklist, then approve it away', async () => {
    // The single source of truth every `returns.list` call reads from — one
    // array, mutated in place by the mocked writes, exactly as the real
    // backend would be.
    let items: ReturnListItem[] = [];

    const apiClient = createMockApiClient();
    apiClient.returns.list = vi.fn(async () => listResult(items)) as unknown as typeof apiClient.returns.list;
    apiClient.orders.list = vi
      .fn()
      .mockResolvedValue({ items: [order()], total: 1, limit: 20, offset: 0 }) as unknown as typeof apiClient.orders.list;
    apiClient.connections.list = vi.fn().mockResolvedValue([connection()]) as unknown as typeof apiClient.connections.list;
    apiClient.returns.record = vi.fn(async (input) => {
      const recorded = listItem({
        id: 'ol_return_recorded',
        origin: 'operator_authored',
        internalOrderId: input.internalOrderId,
        sourceConnectionId: input.sourceConnectionId,
        authorizedAt: null,
      });
      items = [...items, recorded];
      return {
        returnId: recorded.id,
        internalOrderId: recorded.internalOrderId,
        origin: 'operator_authored',
        openedAt: recorded.openedAt,
      };
    }) as unknown as typeof apiClient.returns.record;
    apiClient.returns.authorize = vi.fn(async (returnId: string) => {
      items = items.map((item) =>
        item.id === returnId ? { ...item, authorizedAt: '2026-08-02T00:00:00.000Z' } : item,
      );
      return { outcome: 'authorized', changeId: 'ol_change_1', authorizedAt: '2026-08-02T00:00:00.000Z' };
    }) as unknown as typeof apiClient.returns.authorize;

    renderWithProviders(<ReturnsListPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    // Starting point: the worklist reports nothing waiting.
    expect(await screen.findByText(ORPHAN_RETURNS_WORKLIST_COPY.needsApprovalEmpty)).toBeInTheDocument();

    // 1. Record.
    await userEvent.click(
      await screen.findByRole('button', { name: RECORD_RETURN_DIALOG_COPY.triggerLabel }),
    );
    await userEvent.type(await screen.findByLabelText(RECORD_RETURN_DIALOG_COPY.orderFieldLabel), 'ol_order_1');
    await userEvent.selectOptions(
      screen.getByLabelText(RECORD_RETURN_DIALOG_COPY.connectionFieldLabel),
      'conn_1',
    );
    await userEvent.type(screen.getByLabelText(RECORD_RETURN_DIALOG_COPY.itemFieldLabel), 'Ceramic mug');
    await userEvent.selectOptions(screen.getByLabelText(RECORD_RETURN_DIALOG_COPY.reasonFieldLabel), 'withdrawal');
    await userEvent.click(screen.getByRole('button', { name: RECORD_RETURN_DIALOG_COPY.confirm }));

    await waitFor(() => {
      expect(apiClient.returns.record).toHaveBeenCalled();
    });

    // 2. The recorded return now appears in "Waiting for your OK" — proving
    // the mutation's cache invalidation actually drove a real refetch, not
    // just that the API call happened.
    await waitFor(() => {
      expect(screen.queryByText(ORPHAN_RETURNS_WORKLIST_COPY.needsApprovalEmpty)).not.toBeInTheDocument();
    });
    expect(await screen.findByRole('button', { name: ORPHAN_RETURNS_WORKLIST_COPY.needsApprovalAction })).toBeInTheDocument();

    // 3. Approve it.
    await userEvent.click(
      screen.getByRole('button', { name: ORPHAN_RETURNS_WORKLIST_COPY.needsApprovalAction }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: AUTHORIZE_RETURN_DIALOG_COPY.confirm }),
    );

    await waitFor(() => {
      expect(apiClient.returns.authorize).toHaveBeenCalledWith('ol_return_recorded');
    });

    // 4. Gone from the group again — approving removed it, without this test
    // (or the component) ever splicing an array by hand.
    await waitFor(() => {
      expect(screen.getByText(ORPHAN_RETURNS_WORKLIST_COPY.needsApprovalEmpty)).toBeInTheDocument();
    });
  });

  it('should match an orphan return to an order, navigating from the worklist to the detail page', async () => {
    const orphanItem = listItem({
      id: 'ol_return_orphan',
      externalReturnId: 'AL-RET-1',
      origin: 'source_ingested',
      bucket: 'orphan',
      internalOrderId: null,
      externalOrderId: 'AL-ORD-1',
    });

    // The detail page's own read — mutated in place by the match write, so
    // the page's post-match render reflects a REAL state transition rather
    // than a second, independently-authored fixture.
    let detail: ReturnDetail = {
      id: orphanItem.id,
      counters: orphanItem.counters,
      sourceConnectionId: orphanItem.sourceConnectionId,
      externalReturnId: orphanItem.externalReturnId,
      internalOrderId: null,
      externalOrderId: orphanItem.externalOrderId,
      origin: 'source_ingested',
      bucket: 'orphan',
      rawStatus: 'RETURNED',
      openedAt: orphanItem.openedAt,
      authorizedAt: null,
      declinedAt: null,
      closedAt: null,
      createdAt: orphanItem.createdAt,
      updatedAt: orphanItem.updatedAt,
      lines: [],
      droppedLineCount: 0,
      declineAvailability: { supported: false, reason: 'no-source-return-id' },
      restockBlocked: null,
      restockBlocks: [],
      restockAttestations: [],
      refunds: [],
      orderCurrency: null,
      restockTarget: { status: 'resolved', connectionId: 'conn_master', connectionName: 'Warehouse', candidateCount: null },
    };

    const apiClient = createMockApiClient();
    apiClient.returns.list = vi.fn(async (filters: { bucket?: string } = {}) =>
      listResult(filters.bucket === 'orphan' ? [orphanItem] : []),
    ) as unknown as typeof apiClient.returns.list;
    apiClient.returns.get = vi.fn(async () => detail) as unknown as typeof apiClient.returns.get;
    apiClient.returns.listReturnEventsForReturn = vi.fn().mockResolvedValue([]);
    apiClient.returns.getCorrectionProposal = vi
      .fn()
      .mockResolvedValue({ outcome: 'no-invoice', proposal: null });
    apiClient.orders.list = vi
      .fn()
      .mockResolvedValue({ items: [order({ internalOrderId: 'ol_order_matched' })], total: 1, limit: 20, offset: 0 }) as unknown as typeof apiClient.orders.list;
    apiClient.connections.list = vi.fn().mockResolvedValue([connection()]) as unknown as typeof apiClient.connections.list;
    apiClient.returns.matchOrder = vi.fn(async (returnId: string, input: { internalOrderId: string }) => {
      detail = { ...detail, bucket: 'attributed', internalOrderId: input.internalOrderId };
      return { returnId, internalOrderId: input.internalOrderId, matchedAt: '2026-08-03T00:00:00.000Z' };
    }) as unknown as typeof apiClient.returns.matchOrder;

    renderWithProviders(
      <Routes>
        <Route path="/returns" element={<ReturnsListPage />} />
        <Route path="/returns/:returnId" element={<ReturnDetailPage />} />
      </Routes>,
      { apiClient, route: '/returns', sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    // 1. The worklist's own link is a REAL navigation, not a route: prop
    // pointed straight at the destination.
    await userEvent.click(
      await screen.findByRole('link', { name: ORPHAN_RETURNS_WORKLIST_COPY.needsOrderAction }),
    );

    // 2. Now on the detail page — the orphan banner renders with its match
    // action (#3085's fix to the dead-code dialog).
    expect(await screen.findByText(RETURN_ORPHAN_BANNER_COPY.title)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: RETURN_ORPHAN_BANNER_COPY.matchAction }),
    );

    // 3. Confirm the match.
    expect(await screen.findByText(MATCH_RETURN_DIALOG_COPY.title)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(MATCH_RETURN_DIALOG_COPY.fieldLabel), 'ol_order_matched');
    await userEvent.click(screen.getByRole('button', { name: MATCH_RETURN_DIALOG_COPY.confirm }));

    await waitFor(() => {
      expect(apiClient.returns.matchOrder).toHaveBeenCalledWith('ol_return_orphan', {
        internalOrderId: 'ol_order_matched',
      });
    });

    // 4. The page reflects the real state transition: the orphan banner is
    // gone, because `detail.bucket` is now 'attributed' — not because the
    // test asserted the mutation was called and stopped there.
    await waitFor(() => {
      expect(screen.queryByText(RETURN_ORPHAN_BANNER_COPY.title)).not.toBeInTheDocument();
    });
  });
});
