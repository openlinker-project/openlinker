/**
 * Return Custody Panel — restock-block-vs-dispose gating (#3466)
 *
 * `outstandingToDispose` deliberately never decreases after a blocked restock
 * (#2370's own rule), so before this fix `canDispose` — reading only that
 * number — kept the Dispose form fully re-submittable on a line that already
 * had an unresolved block. Each resubmission minted a fresh event under a
 * fresh idempotency-key `seq` (#2368), so the master-side dedup never caught
 * it, and the restock-blocked banner's summed quantity grew without bound.
 *
 * These tests cover the frontend half of the fix: while a line has an
 * outstanding block the Dispose form stays, but with `Restock` disabled and the
 * dedicated `awaitingAttestation` copy shown. Scrap stays available, because
 * the server accepts it (it makes no master write). `Restock` comes back once
 * the block clears (a real
 * `ReturnDetail` re-render, standing in for the query-invalidation this
 * component receives its `detail` prop through — the panel is a pure function
 * of that prop and does no fetching of its own).
 *
 * @module apps/web/src/features/returns/components
 */
import { cleanup, screen, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import { RETURN_DISPOSE_COPY } from '../lib/return-custody.copy';
import { RETURN_LINES_COPY } from '../lib/return-detail.copy';
import { ReturnCustodyPanel } from './return-custody-panel';
import type { ReturnDetail, ReturnLine, ReturnRestockBlock } from '../api/returns.types';

const RETURN_ID = 'ol_return_1';
const LINE_ID = 'ol_line_1';

const WRITE_ACCESS = { canWrite: true, demoReadOnly: false, visible: true };

function makeLine(overrides: Partial<ReturnLine> = {}): ReturnLine {
  return {
    id: LINE_ID,
    lineIndex: 0,
    externalLineId: 'L-1',
    resolvedOrderLineId: null,
    offerId: null,
    sku: 'SKU-1',
    name: 'Wireless Mouse',
    reason: 'withdrawal',
    quantityAdvised: 5,
    quantityReceived: 5,
    quantityRestocked: 0,
    quantityScrapped: 0,
    custodyState: 'received',
    moneyState: 'pending',
    disposition: null,
    receivedAt: '2026-01-01T00:00:00.000Z',
    disposedAt: null,
    note: null,
    ...overrides,
  };
}

function makeBlock(overrides: Partial<ReturnRestockBlock> = {}): ReturnRestockBlock {
  return {
    eventId: 'evt-1',
    returnLineId: LINE_ID,
    quantity: 2,
    sku: 'SKU-1',
    reason: 'master-refused',
    detail: null,
    connectionId: 'conn_1',
    connectionName: 'Main PrestaShop',
    state: 'blocked',
    ...overrides,
  };
}

function makeDetail(overrides: Partial<ReturnDetail> = {}): ReturnDetail {
  return {
    id: RETURN_ID,
    counters: {
      lineCount: 1,
      notReturnedLineCount: 0,
      quantityAdvised: 5,
      notReturnedQuantityAdvised: 0,
      quantityReceived: 5,
      quantityRestocked: 0,
      quantityScrapped: 0,
    },
    sourceConnectionId: 'conn_source',
    externalReturnId: 'RET-1',
    internalOrderId: 'ol_order_1',
    externalOrderId: 'ORD-1',
    origin: 'source_ingested',
    bucket: 'attributed',
    rawStatus: 'PROCESSING',
    openedAt: '2026-01-01T00:00:00.000Z',
    authorizedAt: null,
    declinedAt: null,
    closedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lines: [makeLine()],
    droppedLineCount: 0,
    declineAvailability: { supported: true, reason: null },
    restockBlocked: null,
    restockBlocks: [],
    restockAttestations: [],
    refunds: [],
    orderCurrency: 'PLN',
    restockTarget: {
      status: 'resolved',
      connectionId: 'conn_master',
      connectionName: 'Main PrestaShop',
      candidateCount: null,
    },
    ...overrides,
  };
}

afterEach(() => cleanup());

function renderPanel(detail: ReturnDetail): RenderResult {
  const apiClient = createMockApiClient();
  return renderWithProviders(
    <ReturnCustodyPanel detail={detail} writeAccess={WRITE_ACCESS} />,
    { apiClient },
  );
}

async function expandLine(): Promise<void> {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('button', {
      name: `${RETURN_LINES_COPY.expandLine} Wireless Mouse`,
    }),
  );
}

describe('ReturnCustodyPanel — restock block gates Restock, not Dispose (#3466)', () => {
  it('should keep the Dispose form but disable Restock while the line has an outstanding block', async () => {
    renderPanel(makeDetail({ restockBlocks: [makeBlock()] }));
    await expandLine();

    // The form stays: scrap makes no master write and the server accepts it on
    // a blocked line, so hiding the form would be stricter than the gate.
    expect(
      screen.getByRole('spinbutton', { name: RETURN_DISPOSE_COPY.quantityLabel }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /restock/i })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /scrap/i })).not.toBeDisabled();
    expect(screen.getByText(RETURN_DISPOSE_COPY.awaitingAttestation)).toBeInTheDocument();
    // The generic "already dealt with" sentence would be a false claim about a
    // write that was REFUSED, not confirmed — it must never render here.
    expect(screen.queryByText(RETURN_DISPOSE_COPY.nothingToDispose)).not.toBeInTheDocument();
  });

  it('should render the Dispose form with Restock available when the line has no block', async () => {
    renderPanel(makeDetail({ restockBlocks: [] }));
    await expandLine();

    // A single outstanding line with no receive left to do opens straight on
    // the dispose form (no mode switch needed).
    expect(screen.getByRole('spinbutton', { name: RETURN_DISPOSE_COPY.quantityLabel })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /restock/i })).not.toBeDisabled();
    expect(screen.queryByText(RETURN_DISPOSE_COPY.awaitingAttestation)).not.toBeInTheDocument();
  });

  it('should ignore a block recorded against a DIFFERENT line', async () => {
    renderPanel(
      makeDetail({
        restockBlocks: [makeBlock({ returnLineId: 'ol_line_other' })],
      }),
    );
    await expandLine();

    expect(screen.getByRole('radio', { name: /restock/i })).not.toBeDisabled();
    expect(screen.queryByText(RETURN_DISPOSE_COPY.awaitingAttestation)).not.toBeInTheDocument();
  });

  it('should re-enable Restock once the block clears', async () => {
    const { rerender } = renderPanel(makeDetail({ restockBlocks: [makeBlock()] }));
    await expandLine();
    expect(screen.getByRole('radio', { name: /restock/i })).toBeDisabled();

    // Stands in for the real flow: `markStockHandledManually` resolves the
    // block server-side, the detail query invalidates, and the next read comes
    // back with `restockBlocks: []`. This component only ever reacts to that
    // prop — it fetches nothing itself — so re-rendering it is the faithful
    // way to exercise that reaction without re-implementing the query cache.
    rerender(
      <ReturnCustodyPanel
        detail={makeDetail({ restockBlocks: [] })}
        writeAccess={WRITE_ACCESS}
      />,
    );

    expect(screen.getByRole('radio', { name: /restock/i })).not.toBeDisabled();
    expect(screen.queryByText(RETURN_DISPOSE_COPY.awaitingAttestation)).not.toBeInTheDocument();
  });
});

describe('ReturnCustodyPanel — backend guard reaches the operator as a sentence (#3466)', () => {
  it('should show the dedicated remedy sentence for a 409 restock-already-blocked', async () => {
    // Defence-in-depth path: reachable only if a resubmission somehow races
    // past the frontend guard (e.g. a stale render). The backend refuses it,
    // and the existing generic 409-reason mapping renders the dedicated
    // sentence with no new frontend parsing code.
    const disposeLine = vi.fn().mockRejectedValue(
      new ApiError('Conflict', 409, { reason: 'restock-already-blocked' }),
    );
    const apiClient = createMockApiClient({ returns: { disposeLine } });
    renderWithProviders(
      <ReturnCustodyPanel
        detail={makeDetail({ restockBlocks: [] })}
        writeAccess={WRITE_ACCESS}
      />,
      { apiClient },
    );

    const user = userEvent.setup();
    await expandLine();
    // The default quantity (everything outstanding) is already a valid
    // submission — nothing about this test needs a different amount.
    await user.click(screen.getByRole('button', { name: RETURN_DISPOSE_COPY.submit }));

    expect(
      await screen.findByText(
        'This line already has a stock write waiting on you — mark it handled before restocking more.',
      ),
    ).toBeInTheDocument();
  });
});
