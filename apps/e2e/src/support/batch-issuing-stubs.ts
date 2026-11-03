/**
 * Batch issuing route stubs (#3585, mockup M15)
 *
 * Puts the live batch screen into each M15 state on any stack, by answering
 * the screen's own reads (`/v1/connections*`, `/v1/sales-documents/batches/*`)
 * from fixtures shaped like the API responses. Two of the six states
 * (`running`, `unavailable`) cannot be produced on demand against a real
 * stack - a run lasts seconds, and `needs_reauth` is set only by a provider
 * refusing a credential - so this suite stubs all six for one consistent
 * baseline. The real round trip is `golden-path.spec.ts`.
 *
 * Only reads are stubbed. "Run now" is never pressed here.
 *
 * @module support
 */
import type { Page, Route } from '@playwright/test';
import type { M15State } from '../pages/batch-issuing.page';

export const STUB_CONNECTION_ID = '55555555-5555-4555-8555-555555555501';
const SOURCE_CONNECTION_ID = '55555555-5555-4555-8555-555555555502';

const connection = (status: 'active' | 'needs_reauth'): Record<string, unknown> => ({
  id: STUB_CONNECTION_ID,
  name: 'eparagony.pl',
  platformType: 'eparagony',
  status,
  config: {
    salesDocument: {
      documentKind: 'both',
      triggerModels: { invoice: 'batched', 'fiscal-receipt': 'batched' },
    },
  },
  credentialsBacked: true,
  credentialsStored: true,
  adapterKey: 'eparagony.documents.v3',
  enabledCapabilities: ['Invoicing', 'Fiscalization'],
  supportedCapabilities: ['Invoicing', 'Fiscalization'],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
});

const source = {
  id: SOURCE_CONNECTION_ID,
  name: 'Allegro',
  platformType: 'allegro',
  status: 'active',
  config: {},
  credentialsBacked: true,
  adapterKey: 'allegro.publicapi.v1',
  enabledCapabilities: ['OrderSource'],
  supportedCapabilities: ['OrderSource'],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const schedule = (kind: string, frequency: string, time: string | null) => ({
  documentKind: kind,
  batched: true,
  frequency,
  time,
  everyHours: null,
  timeZone: 'Europe/Warsaw',
  nextSlots: [{ segment: 'all', slotAt: '2099-09-26T16:00:00.000Z' }],
});

const queueEntry = (orderId: string, orderNumber: string, kind: string, buyer: string) => ({
  orderId,
  sourceConnectionId: SOURCE_CONNECTION_ID,
  documentKind: kind,
  placedAt: '2026-09-24T19:40:00.000Z',
  totalAmount: 249,
  currency: 'PLN',
  isB2b: kind === 'invoice',
  orderNumber,
  buyerName: buyer,
});

const QUEUE = [
  queueEntry('ol_order_g10_1', 'ALG-24917', 'invoice', 'Anna Kowalska'),
  queueEntry('ol_order_g10_2', 'ERL-1042', 'fiscal-receipt', 'Jan Nowak'),
  queueEntry('ol_order_g10_3', 'PS-3387', 'fiscal-receipt', 'Piotr Wiśniewski'),
  queueEntry('ol_order_g10_4', 'WC-1204', 'invoice', 'Katarzyna Zielińska'),
];

const run = (overrides: Record<string, unknown>) => ({
  id: 'run-finished',
  connectionId: STUB_CONNECTION_ID,
  trigger: 'schedule',
  documentKinds: ['invoice', 'fiscal-receipt'],
  segment: 'all',
  slotAt: '2026-09-26T16:00:00.000Z',
  status: 'completed',
  failureReason: null,
  eligibleCount: 3,
  enqueuedCount: 2,
  blockedCount: 1,
  startedAt: '2026-09-26T16:00:00.000Z',
  finishedAt: '2026-09-26T16:01:24.000Z',
  ...overrides,
});

const FINISHED_RUN = run({});
const RUNNING_RUN = run({ id: 'run-running', status: 'running', finishedAt: null });

const item = (orderId: string, orderNumber: string, overrides: Record<string, unknown>) => ({
  orderId,
  documentKind: 'invoice',
  result: 'enqueued',
  outcome: 'issued',
  blockReason: null,
  orderNumber,
  buyerName: 'Anna Kowalska',
  documentNumber: null,
  ...overrides,
});

const FINISHED_ITEMS = [
  item('ol_order_g10_9', 'ALG-24900', { documentNumber: 'FV/512/09/2026' }),
  item('ol_order_g10_8', 'ALG-24933', {
    result: 'already-documented',
    outcome: 'blocked',
    buyerName: 'Marek Dąbrowski',
  }),
  item('ol_order_g10_7', 'ALG-24950', { outcome: 'in-doubt' }),
];

interface StateFixture {
  status: 'active' | 'needs_reauth';
  queue: unknown[];
  queueCounts: Record<string, number>;
  runningRun: unknown;
  runs: unknown[];
  runItems: Record<string, unknown[]>;
}

function fixtureFor(state: M15State): StateFixture {
  const counts = { invoice: 2, 'fiscal-receipt': 2 };
  switch (state) {
    case 'empty':
      return {
        status: 'active',
        queue: [],
        queueCounts: {},
        runningRun: null,
        runs: [],
        runItems: {},
      };
    case 'running':
      return {
        status: 'active',
        queue: QUEUE,
        queueCounts: counts,
        runningRun: RUNNING_RUN,
        runs: [RUNNING_RUN, FINISHED_RUN],
        runItems: {
          'run-running': [item('ol_order_g10_1', 'ALG-24917', { outcome: 'pending' })],
          'run-finished': FINISHED_ITEMS,
        },
      };
    case 'unavailable':
      return {
        status: 'needs_reauth',
        queue: QUEUE,
        queueCounts: counts,
        runningRun: null,
        runs: [FINISHED_RUN],
        runItems: { 'run-finished': FINISHED_ITEMS },
      };
    default:
      return {
        status: 'active',
        queue: QUEUE,
        queueCounts: counts,
        runningRun: null,
        runs: [FINISHED_RUN],
        runItems: { 'run-finished': FINISHED_ITEMS },
      };
  }
}

function json(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

/** Answer every read the batch screen makes with the fixture for `state`. */
export async function stubBatchIssuingState(page: Page, state: M15State): Promise<void> {
  const fixture = fixtureFor(state);
  const conn = connection(fixture.status);

  await page.route('**/v1/connections', (route) => json(route, [conn, source]));
  await page.route(`**/v1/connections/${STUB_CONNECTION_ID}`, (route) => json(route, conn));
  await page.route(`**/v1/sales-documents/batches/${STUB_CONNECTION_ID}**`, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/sales-documents\/batches\/[^/]+/, '');
    if (route.request().method() !== 'GET') {
      return route.fulfill({ status: 405, body: '{}' });
    }
    if (path === '' || path === '/') {
      return json(route, {
        connectionId: STUB_CONNECTION_ID,
        schedules: [
          schedule('invoice', 'month-end', null),
          schedule('fiscal-receipt', 'daily', '18:00'),
        ],
        queueCounts: fixture.queueCounts,
        runningRun: fixture.runningRun,
      });
    }
    if (path === '/queue') return json(route, { items: fixture.queue, nextCursor: null });
    if (path === '/runs') return json(route, { runs: fixture.runs, total: fixture.runs.length });
    const runMatch = /^\/runs\/([^/]+)$/.exec(path);
    if (runMatch) {
      const runId = decodeURIComponent(runMatch[1]);
      const found = (fixture.runs as Array<{ id: string }>).find((r) => r.id === runId);
      if (!found) return route.fulfill({ status: 404, body: '{}' });
      return json(route, { run: found, items: fixture.runItems[runId] ?? [] });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
}

/** Which tab shows each state; `unavailable` reads from the queue tab like M15 does. */
export const TAB_FOR_STATE: Record<M15State, 'Schedule' | 'Next batch' | 'Run history'> = {
  settings: 'Schedule',
  queue: 'Next batch',
  running: 'Next batch',
  finished: 'Run history',
  empty: 'Next batch',
  unavailable: 'Next batch',
};
