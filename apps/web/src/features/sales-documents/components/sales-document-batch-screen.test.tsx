/**
 * SalesDocumentBatchScreen tests (#3584, mockup M15)
 *
 * One test per M15 state: settings, queue, running, finished, empty and
 * unavailable, plus "Run now" and the D42 month-end note.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import type { Connection } from '../../connections';
import type {
  BatchOverview,
  BatchQueueEntry,
  BatchRun,
  BatchRunDetail,
} from '../api/sales-document-batch.types';
import { SalesDocumentBatchScreen } from './sales-document-batch-screen';

const CONNECTION: Connection = {
  ...sampleConnection,
  id: 'conn-ep',
  name: 'eparagony.pl',
  status: 'active',
};

const overview = (overrides: Partial<BatchOverview> = {}): BatchOverview => ({
  connectionId: 'conn-ep',
  schedules: [
    {
      documentKind: 'invoice',
      batched: true,
      frequency: 'daily',
      time: '18:00',
      everyHours: null,
      timeZone: 'Europe/Warsaw',
      nextSlots: [{ segment: 'all', slotAt: '2099-01-01T17:00:00.000Z' }],
    },
    {
      documentKind: 'fiscal-receipt',
      batched: false,
      frequency: null,
      time: null,
      everyHours: null,
      timeZone: null,
      nextSlots: [],
    },
  ],
  queueCounts: { invoice: 2 },
  runningRun: null,
  ...overrides,
});

const entry = (orderId: string, orderNumber: string): BatchQueueEntry => ({
  orderId,
  sourceConnectionId: 'src-1',
  documentKind: 'invoice',
  placedAt: '2026-09-24T19:40:00.000Z',
  totalAmount: 249,
  currency: 'PLN',
  isB2b: false,
  orderNumber,
  buyerName: 'Anna Kowalska',
});

const finishedRun: BatchRun = {
  id: 'run-1',
  connectionId: 'conn-ep',
  trigger: 'schedule',
  documentKinds: ['invoice'],
  segment: 'all',
  slotAt: '2026-09-26T16:00:00.000Z',
  status: 'completed',
  failureReason: null,
  eligibleCount: 2,
  enqueuedCount: 1,
  blockedCount: 1,
  startedAt: '2026-09-26T16:00:00.000Z',
  finishedAt: '2026-09-26T16:01:24.000Z',
};

const finishedDetail: BatchRunDetail = {
  run: finishedRun,
  items: [
    {
      orderId: 'o-1',
      documentKind: 'invoice',
      result: 'enqueued',
      outcome: 'issued',
      blockReason: null,
      orderNumber: 'ALG-24917',
      buyerName: 'Anna Kowalska',
      documentNumber: 'FV/512/09/2026',
    },
    {
      orderId: 'o-2',
      documentKind: 'invoice',
      result: 'already-documented',
      outcome: 'blocked',
      blockReason: null,
      orderNumber: 'ALG-24933',
      buyerName: 'Marek Dąbrowski',
      documentNumber: null,
    },
  ],
};

function setup(options: {
  connection?: Connection;
  overview?: BatchOverview;
  queue?: BatchQueueEntry[];
  runs?: BatchRun[];
  detail?: BatchRunDetail;
  startRun?: (connectionId: string) => Promise<{ jobId: string }>;
}): ReturnType<typeof createMockApiClient> {
  const apiClient = createMockApiClient({
    connections: {
      getById: vi.fn().mockResolvedValue(options.connection ?? CONNECTION),
      list: vi.fn().mockResolvedValue([{ ...sampleConnection, id: 'src-1', name: 'Allegro' }]),
    },
    salesDocumentBatch: {
      getOverview: vi.fn().mockResolvedValue(options.overview ?? overview()),
      getQueue: vi.fn().mockResolvedValue({ items: options.queue ?? [], nextCursor: null }),
      listRuns: vi
        .fn()
        .mockResolvedValue({ runs: options.runs ?? [], total: options.runs?.length ?? 0 }),
      getRun: vi.fn().mockResolvedValue(options.detail ?? finishedDetail),
      ...(options.startRun ? { startRun: options.startRun } : {}),
    },
  });
  renderWithProviders(<SalesDocumentBatchScreen connectionId="conn-ep" />, {
    apiClient,
    sessionAdapter: createAuthenticatedSessionAdapter(),
  });
  return apiClient;
}

describe('SalesDocumentBatchScreen', () => {
  it('settings: shows the next run and one schedule form per batched kind', async () => {
    setup({ runs: [finishedRun] });

    expect(await screen.findByText('Batch issuing is on')).toBeInTheDocument();
    expect(screen.getByText(/2 queued/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Invoices' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Fiscal receipts' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save invoices schedule' })).toBeInTheDocument();
  });

  it('settings: states D42 when month end is chosen', async () => {
    const user = userEvent.setup();
    setup({});

    await user.selectOptions(await screen.findByLabelText('Frequency'), 'month-end');

    expect(
      screen.getByText(/Orders without one on this connection go out every day at 23:00/)
    ).toBeInTheDocument();
  });

  it('queue: lists queued orders, the last run refusals, and filters by chip', async () => {
    const user = userEvent.setup();
    setup({ queue: [entry('o-3', 'WC-1204'), entry('o-4', 'WC-1209')], runs: [finishedRun] });

    await user.click(await screen.findByRole('tab', { name: /Next batch/ }));

    expect(await screen.findByText('WC-1204')).toBeInTheDocument();
    expect(await screen.findByText('ALG-24933')).toBeInTheDocument();
    // Both queued orders came in through the same connection.
    expect(screen.getAllByText('Allegro', { selector: 'td' })).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Blocked · 1' }));
    expect(screen.queryByText('WC-1204')).not.toBeInTheDocument();
    expect(screen.getByText('Already has a document on another connection.')).toBeInTheDocument();
  });

  it('queue: Run now starts a run', async () => {
    const user = userEvent.setup();
    const startRun = vi.fn().mockResolvedValue({ jobId: 'job-1' });
    setup({ queue: [entry('o-3', 'WC-1204')], startRun });

    await user.click(await screen.findByRole('tab', { name: /Next batch/ }));
    await user.click(await screen.findByRole('button', { name: 'Run now' }));

    await waitFor(() => expect(startRun).toHaveBeenCalledWith('conn-ep'));
    expect(await screen.findByText(/The run has been queued/)).toBeInTheDocument();
    // Until the run shows up, a second click must not queue a second run.
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
  });

  it('running: shows progress and the orders still queued', async () => {
    const user = userEvent.setup();
    const runningRun: BatchRun = {
      ...finishedRun,
      id: 'run-2',
      status: 'running',
      finishedAt: null,
    };
    setup({
      overview: overview({ runningRun }),
      queue: [entry('o-1', 'ALG-24917'), entry('o-5', 'ERL-1055')],
      runs: [runningRun, finishedRun],
      detail: { run: runningRun, items: [finishedDetail.items[0]] },
    });

    await user.click(await screen.findByRole('tab', { name: /Next batch/ }));

    expect(await screen.findByText(/Processed 1 of 2 orders/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    const row = screen.getByText('ERL-1055').closest('tr');
    expect(row && within(row).getByText('Queued')).toBeInTheDocument();
  });

  it('finished: shows run history and per-order outcomes', async () => {
    const user = userEvent.setup();
    setup({ runs: [finishedRun] });

    await user.click(await screen.findByRole('tab', { name: 'Run history' }));

    expect(await screen.findByText('Completed with issues')).toBeInTheDocument();
    expect(await screen.findByText('FV/512/09/2026')).toBeInTheDocument();
    const issuedRow = screen.getByText('ALG-24917').closest('tr');
    expect(issuedRow && within(issuedRow).getByText('Issued')).toBeInTheDocument();
  });

  it('empty: says nothing is waiting and disables Run now', async () => {
    const user = userEvent.setup();
    setup({ overview: overview({ queueCounts: {} }) });

    await user.click(await screen.findByRole('tab', { name: /Next batch/ }));

    expect(await screen.findByText('Nothing waiting for the next batch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled();
  });

  it('unavailable: warns that the connection needs reconnecting and refuses Run now', async () => {
    const user = userEvent.setup();
    setup({
      connection: { ...CONNECTION, status: 'needs_reauth' },
      queue: [entry('o-3', 'WC-1204')],
    });

    expect(await screen.findByText('eparagony.pl needs reconnecting')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to connection' })).toHaveAttribute(
      'href',
      '/connections/conn-ep'
    );

    await user.click(screen.getByRole('tab', { name: /Next batch/ }));
    expect(await screen.findByText('WC-1204')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled();
  });
});
