/**
 * Allegro Returns Cursor-Safety Integration Test (#2330)
 *
 * The headline guarantee, asserted against a real Postgres cursor row rather
 * than a mock: **a failed child enqueue must never advance the returns cursor.**
 *
 * This is the one that matters because the failure it prevents is silent and
 * permanent. A cursor is a claim that the items before it have been dealt with;
 * committing one while the children never reached the queue loses those returns
 * with no error anywhere, and a lost return is a buyer waiting for money nobody
 * will ever be told about. The unit spec proves the branch; this proves the row.
 *
 * @module apps/worker/test/integration
 */
import { DataSource } from 'typeorm';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import {
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
  ConnectionCursorRepositoryPort,
  SYNC_JOB_QUEUE_TOKEN,
  SyncJobQueuePort,
} from '@openlinker/core/sync';
import { INTEGRATIONS_SERVICE_TOKEN, IIntegrationsService } from '@openlinker/core/integrations';
import {
  IReturnIngestionService,
  RETURN_INGESTION_SERVICE_TOKEN,
} from '@openlinker/core/returns';

const CURSOR_KEY = 'allegro.customerReturns.lastReturnId';

function feedPage(ids: string[], nextCursor: string | null) {
  return {
    items: ids.map((id) => ({
      externalReturnId: id,
      externalOrderId: `order-${id}`,
      occurredAt: '2026-01-11T09:36:57.000Z',
      eventKey: id,
    })),
    nextCursor,
  };
}

function mockReturnReader(page: ReturnType<typeof feedPage>) {
  return {
    listOrderFeed: jest.fn(),
    getOrder: jest.fn(),
    listReturnFeed: jest.fn().mockResolvedValue(page),
    getReturn: jest.fn(),
    terminalRawStatuses: ['FINISHED', 'FINISHED_APT', 'REJECTED', 'COMMISSION_REFUNDED'],
  };
}

describe('Allegro Returns — cursor safety (#2330)', () => {
  let harness: WorkerIntegrationTestHarness;
  let dataSource: DataSource;
  let cursors: ConnectionCursorRepositoryPort;
  let integrations: IIntegrationsService;
  let ingestion: IReturnIngestionService;
  let queue: SyncJobQueuePort;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    cursors = harness.get(CONNECTION_CURSOR_REPOSITORY_TOKEN);
    integrations = harness.get(INTEGRATIONS_SERVICE_TOKEN);
    ingestion = harness.get(RETURN_INGESTION_SERVICE_TOKEN);
    queue = harness.get(SYNC_JOB_QUEUE_TOKEN);
  });

  beforeEach(async () => {
    await resetTestHarness();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  async function allegroConnection() {
    return createTestConnection(dataSource, {
      platformType: 'allegro',
      status: 'active',
      credentialsRef: 'test-credentials-ref',
      adapterKey: 'allegro.publicapi.v1',
    });
  }

  it('should leave the cursor UNCHANGED when the child enqueue fails', async () => {
    const connection = await allegroConnection();
    await cursors.set(connection.id, CURSOR_KEY, 'r-0');

    jest
      .spyOn(integrations, 'getCapabilityAdapter')
      .mockResolvedValue(mockReturnReader(feedPage(['r-1', 'r-2', 'r-3'], 'r-3')) as never);
    jest.spyOn(queue, 'enqueueBulk').mockRejectedValue(new Error('stream unavailable'));

    await expect(
      ingestion.ingestReturns(connection.id, { cursorKey: CURSOR_KEY, limit: 100 })
    ).rejects.toThrow('stream unavailable');

    // The row itself, re-read from Postgres.
    expect(await cursors.get(connection.id, CURSOR_KEY)).toBe('r-0');
  });

  it('should advance the persisted cursor once the same page enqueues successfully', async () => {
    const connection = await allegroConnection();
    await cursors.set(connection.id, CURSOR_KEY, 'r-0');

    jest
      .spyOn(integrations, 'getCapabilityAdapter')
      .mockResolvedValue(mockReturnReader(feedPage(['r-1', 'r-2', 'r-3'], 'r-3')) as never);
    const enqueueBulk = jest.spyOn(queue, 'enqueueBulk').mockResolvedValue(undefined as never);

    const result = await ingestion.ingestReturns(connection.id, {
      cursorKey: CURSOR_KEY,
      limit: 100,
    });

    expect(result).toMatchObject({ fetched: 3, enqueued: 3, committed: true });
    expect(await cursors.get(connection.id, CURSOR_KEY)).toBe('r-3');

    // And the children are connection-scoped and keyed per return, so a replay
    // of the same page dedupes rather than duplicating.
    const requests = enqueueBulk.mock.calls[0][0] as Array<{
      type: string;
      connectionId: string;
      options: { dedupeKey: string };
    }>;
    expect(requests.map((r) => r.options.dedupeKey)).toEqual([
      `marketplace:${connection.id}:return:r-1`,
      `marketplace:${connection.id}:return:r-2`,
      `marketplace:${connection.id}:return:r-3`,
    ]);
    expect(new Set(requests.map((r) => r.type))).toEqual(new Set(['marketplace.return.sync']));
  });

  it('should hold the cursor per connection — one connection failing never moves another', async () => {
    const failing = await allegroConnection();
    const healthy = await allegroConnection();
    await cursors.set(failing.id, CURSOR_KEY, 'a-0');
    await cursors.set(healthy.id, CURSOR_KEY, 'b-0');

    jest
      .spyOn(integrations, 'getCapabilityAdapter')
      .mockImplementation(async (connectionId: string) =>
        mockReturnReader(
          connectionId === failing.id ? feedPage(['a-1'], 'a-1') : feedPage(['b-1'], 'b-1')
        ) as never
      );
    jest
      .spyOn(queue, 'enqueueBulk')
      .mockImplementation(async (requests: Array<{ connectionId: string }>) => {
        if (requests[0]?.connectionId === failing.id) {
          throw new Error('stream unavailable');
        }
        return undefined as never;
      });

    await expect(
      ingestion.ingestReturns(failing.id, { cursorKey: CURSOR_KEY, limit: 100 })
    ).rejects.toThrow();
    await ingestion.ingestReturns(healthy.id, { cursorKey: CURSOR_KEY, limit: 100 });

    expect(await cursors.get(failing.id, CURSOR_KEY)).toBe('a-0');
    expect(await cursors.get(healthy.id, CURSOR_KEY)).toBe('b-1');
  });

  it('should hold the cursor on an empty page rather than blanking it', async () => {
    const connection = await allegroConnection();
    await cursors.set(connection.id, CURSOR_KEY, 'r-7');

    jest
      .spyOn(integrations, 'getCapabilityAdapter')
      .mockResolvedValue(mockReturnReader(feedPage([], 'r-7')) as never);

    const result = await ingestion.ingestReturns(connection.id, {
      cursorKey: CURSOR_KEY,
      limit: 100,
    });

    expect(result.committed).toBe(false);
    expect(await cursors.get(connection.id, CURSOR_KEY)).toBe('r-7');
  });
});
