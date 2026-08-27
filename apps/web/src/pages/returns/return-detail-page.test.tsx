import { cleanup, screen, waitFor, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import { ApiError } from '../../shared/api/api-error';
import { ReturnDetailUnreadableError, type ReturnDetail, type ReturnLine } from '../../features/returns';
import { ReturnDetailPage } from './return-detail-page';
import type { Connection } from '../../features/connections/api/connections.types';

const RETURN_ID = 'ol_return_aaaaaaaa1111';

function makeConnection(): Connection {
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
  };
}

function makeLine(overrides: Partial<ReturnLine> = {}): ReturnLine {
  return {
    id: 'ol_line_1',
    lineIndex: 0,
    externalLineId: 'L-1',
    resolvedOrderLineId: null,
    offerId: null,
    sku: 'SKU-1',
    name: 'Blue shirt',
    reason: 'withdrawal',
    quantityAdvised: 2,
    quantityReceived: 0,
    quantityRestocked: 0,
    quantityScrapped: 0,
    custodyState: 'advised',
    moneyState: 'pending',
    disposition: null,
    receivedAt: null,
    disposedAt: null,
    note: null,
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
      quantityReceived: 0,
      quantityRestocked: 0,
      quantityScrapped: 0,
    },
    sourceConnectionId: 'conn_1',
    externalReturnId: 'RET-1',
    internalOrderId: 'ol_order_bbbbbbbb2222',
    externalOrderId: 'ORD-1',
    origin: 'source_ingested',
    bucket: 'attributed',
    rawStatus: 'COMMISSION_REFUND_CLAIMED',
    openedAt: '2026-01-01T00:00:00.000Z',
    authorizedAt: null,
    declinedAt: null,
    closedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lines: [makeLine()],
    droppedLineCount: 0,
    declineAvailability: { supported: true, reason: null },
    ...overrides,
  };
}

interface SetupOptions {
  detail?: ReturnDetail;
  getError?: unknown;
  declineFn?: Mock;
  getFn?: Mock;
  authenticated?: boolean;
}

interface SetupResult extends RenderResult {
  getFn: Mock;
  declineFn: Mock;
}

function setup(options: SetupOptions = {}): SetupResult {
  const getFn =
    options.getFn ??
    (options.getError !== undefined
      ? vi.fn().mockRejectedValue(options.getError)
      : vi.fn().mockResolvedValue(options.detail ?? makeDetail()));
  const declineFn = options.declineFn ?? vi.fn();

  const apiClient = createMockApiClient({
    returns: { get: getFn, decline: declineFn },
    connections: { list: vi.fn().mockResolvedValue([makeConnection()]) },
  });

  const result = renderWithProviders(
    <Routes>
      <Route path="/returns/:returnId" element={<ReturnDetailPage />} />
    </Routes>,
    {
      apiClient,
      route: `/returns/${RETURN_ID}`,
      ...(options.authenticated === false
        ? {}
        : { sessionAdapter: createAuthenticatedSessionAdapter() }),
    },
  );

  return { ...result, getFn, declineFn };
}

describe('ReturnDetailPage', () => {
  afterEach(cleanup);

  describe('the source status', () => {
    it('should render the raw status verbatim, attributed to the channel', async () => {
      setup();

      // Verbatim: the exact string the channel sent, with the channel's own
      // name as the attribution — never re-labelled into OL vocabulary.
      expect(
        await screen.findByText(/Allegro Main: COMMISSION_REFUND_CLAIMED/),
      ).toBeInTheDocument();
    });

    it('should say the status was not reported when the channel sent none', async () => {
      setup({ detail: makeDetail({ rawStatus: null }) });

      expect(await screen.findByText('Not reported')).toBeInTheDocument();
    });
  });

  describe('lines', () => {
    it('should state that a line could not be matched rather than rendering a blank', async () => {
      setup();

      expect(await screen.findByText('Could not be matched to a line')).toBeInTheDocument();
    });

    it('should render the resolved order line when the channel matched it', async () => {
      setup({ detail: makeDetail({ lines: [makeLine({ resolvedOrderLineId: 'line-7' })] }) });

      expect(await screen.findByText('line-7')).toBeInTheDocument();
      expect(screen.queryByText('Could not be matched to a line')).not.toBeInTheDocument();
    });

    it('should report lines this build could not read', async () => {
      setup({ detail: makeDetail({ droppedLineCount: 2 }) });

      expect(
        await screen.findByText('2 lines of this return could not be read and are not shown.'),
      ).toBeInTheDocument();
    });
  });

  describe('orphan returns', () => {
    it('should render the orphan banner and disable the decline action with its reason', async () => {
      setup({
        detail: makeDetail({ bucket: 'orphan', internalOrderId: null }),
      });

      expect(await screen.findByText('This return is not matched to an order')).toBeInTheDocument();
      expect(
        screen.getByText(/not matched to an order, so nothing can be sent to the channel/),
      ).toBeInTheDocument();
      // Visible AND disabled — a missing button is indistinguishable from a bug.
      expect(screen.getByRole('button', { name: 'Decline return' })).toBeDisabled();
    });
  });

  describe('failure branches', () => {
    it('should render a not-found state for a 404, not an error state', async () => {
      setup({ getError: new ApiError('nope', 404, {}) });

      // The page title and the empty state carry the same words on purpose —
      // the heading orients, the state explains — so both are expected here.
      expect(await screen.findAllByText('Return not found')).toHaveLength(2);
      expect(
        screen.getByText('This return does not exist, or it has been removed.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });

    it('should distinguish an unreadable record from a failed request', async () => {
      setup({ getError: new ReturnDetailUnreadableError(RETURN_ID) });

      expect(await screen.findByText('Return could not be read')).toBeInTheDocument();
    });

    it('should render the shared loading primitive, not a blank div, while fetching', async () => {
      // `panel-skeleton` had no CSS rule anywhere, so the loading state was an
      // empty unstyled div: a blank page for a sighted operator, with only
      // `aria-busy` for assistive tech.
      setup({ getFn: vi.fn().mockReturnValue(new Promise(() => undefined)) });

      expect(await screen.findByText('Loading return…')).toBeInTheDocument();
      expect(screen.getByText('Fetching this return and its lines.')).toBeInTheDocument();
    });

    it('should render the error state with a retry for any other failure', async () => {
      setup({ getError: new ApiError('offline', 0, {}) });

      expect(await screen.findByText('Unable to load return')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
  });

  describe('the decline action', () => {
    it('should require a confirm and send exactly one request on a double submit', async () => {
      const user = userEvent.setup();
      let resolveDecline: ((value: unknown) => void) | undefined;
      const declineFn = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveDecline = resolve;
        }),
      );

      setup({ declineFn });

      await user.click(await screen.findByRole('button', { name: 'Decline return' }));
      // Nothing is sent by opening the dialog — the confirm is the action.
      expect(declineFn).not.toHaveBeenCalled();

      await user.type(screen.getByLabelText('Channel rejection code'), 'REFUND_REJECTED');
      const send = screen.getByRole('button', { name: 'Send decline' });
      await user.click(send);
      await user.click(send);

      expect(declineFn).toHaveBeenCalledTimes(1);
      resolveDecline?.({
        outcome: 'decline-sent',
        changeId: 'chg-1',
        declinedAt: null,
        refusalReason: null,
      });
    });

    it('should refuse to submit without a rejection code', async () => {
      const user = userEvent.setup();
      const declineFn = vi.fn();
      setup({ declineFn });

      await user.click(await screen.findByRole('button', { name: 'Decline return' }));
      await user.click(screen.getByRole('button', { name: 'Send decline' }));

      expect(declineFn).not.toHaveBeenCalled();
      expect(screen.getByText('Enter the channel’s rejection code.')).toBeInTheDocument();
    });

    it('should never display a decline-sent outcome as declined', async () => {
      const user = userEvent.setup();
      const declineFn = vi.fn().mockResolvedValue({
        outcome: 'decline-sent',
        changeId: 'chg-1',
        declinedAt: null,
        refusalReason: null,
      });

      setup({ declineFn });

      await user.click(await screen.findByRole('button', { name: 'Decline return' }));
      await user.type(screen.getByLabelText('Channel rejection code'), 'REFUND_REJECTED');
      await user.click(screen.getByRole('button', { name: 'Send decline' }));

      expect(await screen.findByText('Decline sent')).toBeInTheDocument();
      expect(
        screen.getByText(/has the request and has not yet reported the outcome/),
      ).toBeInTheDocument();
      // The header keeps stating the record: no decline instant, no Declined badge.
      expect(screen.queryByText('Declined')).not.toBeInTheDocument();
    });

    it("should render the channel's own words when it refuses", async () => {
      const user = userEvent.setup();
      const declineFn = vi.fn().mockResolvedValue({
        outcome: 'refused',
        changeId: 'chg-1',
        declinedAt: null,
        refusalReason: 'Rejection window has closed',
      });

      setup({ declineFn });

      await user.click(await screen.findByRole('button', { name: 'Decline return' }));
      await user.type(screen.getByLabelText('Channel rejection code'), 'REFUND_REJECTED');
      await user.click(screen.getByRole('button', { name: 'Send decline' }));

      expect(await screen.findByText('The channel refused the request')).toBeInTheDocument();
      expect(screen.getByText('Rejection window has closed')).toBeInTheDocument();
    });

    it('should name the blocked trigger from the error body on a 409', async () => {
      const user = userEvent.setup();
      const declineFn = vi
        .fn()
        .mockRejectedValue(new ApiError('not attributed', 409, { trigger: 'decline' }));

      setup({ declineFn });

      await user.click(await screen.findByRole('button', { name: 'Decline return' }));
      await user.type(screen.getByLabelText('Channel rejection code'), 'REFUND_REJECTED');
      await user.click(screen.getByRole('button', { name: 'Send decline' }));

      await waitFor(() => {
        expect(screen.getByText(/Blocked action: decline/)).toBeInTheDocument();
      });
      // The dialog stays open so the operator keeps the code they typed.
      expect(screen.getByLabelText('Channel rejection code')).toBeInTheDocument();
    });

    it('should explain an unsupported source instead of offering the action', async () => {
      setup({
        detail: makeDetail({
          declineAvailability: { supported: false, reason: 'source-declares-no-decline' },
        }),
      });

      expect(
        await screen.findByText(/publishes no way to decline a return/),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Decline return' })).toBeDisabled();
    });

    it('should explain a missing channel reference distinctly from an unsupported channel', async () => {
      setup({
        detail: makeDetail({
          declineAvailability: { supported: false, reason: 'no-source-return-id' },
        }),
      });

      expect(await screen.findByText(/no reference at the channel/)).toBeInTheDocument();
    });

    it('should hold the action back when the reason is one this build does not recognise', async () => {
      setup({
        detail: makeDetail({
          declineAvailability: { supported: false, reason: 'some-future-reason' },
        }),
      });

      expect(
        await screen.findByText(/could not establish whether this channel accepts a decline/),
      ).toBeInTheDocument();
    });

    it('should hide the action entirely for a session with no write access', async () => {
      setup({ authenticated: false });

      // The permission axis is the house policy (hidden for a plain
      // unauthorized session), distinct from the record's own state.
      expect(await screen.findByText(/Allegro Main: COMMISSION_REFUND_CLAIMED/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Decline return' })).not.toBeInTheDocument();
    });
  });
});
