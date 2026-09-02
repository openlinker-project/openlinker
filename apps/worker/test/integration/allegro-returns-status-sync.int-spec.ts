/**
 * Allegro Returns Status Sync Integration Test (#2330)
 *
 * Pass 2 against real Postgres: the terminal-status exclusion happens IN THE
 * QUERY, the scan offset persists on the connection cursor, and a return that
 * reaches a terminal status drops out of the candidate set by itself.
 *
 * The exclusion is worth an integration test rather than a unit one because it
 * is SQL — `NOT IN (:...list)` over an empty list is a Postgres syntax error, so
 * the degraded case (an adapter that declares no terminal vocabulary) can only
 * be proved against a real database.
 *
 * @module apps/worker/test/integration
 */
import { DataSource } from 'typeorm';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { INTEGRATIONS_SERVICE_TOKEN, IIntegrationsService } from '@openlinker/core/integrations';
import {
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
  ConnectionCursorRepositoryPort,
} from '@openlinker/core/sync';
import {
  IReturnsService,
  IReturnStatusSyncService,
  RETURNS_SERVICE_TOKEN,
  RETURN_STATUS_SYNC_SERVICE_TOKEN,
} from '@openlinker/core/returns';

const TERMINAL = ['FINISHED', 'FINISHED_APT', 'REJECTED', 'COMMISSION_REFUNDED'];
const CURSOR_KEY = 'allegro.customerReturns.scanOffset';

function observation(id: string, rawStatus: string, createdAt = '2026-08-01T09:00:00.000Z') {
  return {
    externalReturnId: id,
    externalOrderId: null,
    rawStatus,
    createdAt,
    lines: [{ offerId: `offer-${id}`, quantity: 1, reasonRaw: 'MISTAKE' }],
  };
}

function mockReader(getReturn: jest.Mock, terminalRawStatuses: readonly string[] | undefined) {
  const reader: Record<string, unknown> = {
    listOrderFeed: jest.fn(),
    getOrder: jest.fn(),
    listReturnFeed: jest.fn(),
    getReturn,
  };
  if (terminalRawStatuses !== undefined) {
    reader.terminalRawStatuses = terminalRawStatuses;
  }
  return reader;
}

describe('Allegro Returns — status sync sweep (#2330)', () => {
  let harness: WorkerIntegrationTestHarness;
  let dataSource: DataSource;
  let integrations: IIntegrationsService;
  let returns: IReturnsService;
  let sweep: IReturnStatusSyncService;
  let cursors: ConnectionCursorRepositoryPort;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    integrations = harness.get(INTEGRATIONS_SERVICE_TOKEN);
    returns = harness.get(RETURNS_SERVICE_TOKEN);
    sweep = harness.get(RETURN_STATUS_SYNC_SERVICE_TOKEN);
    cursors = harness.get(CONNECTION_CURSOR_REPOSITORY_TOKEN);
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

  /** Seed rows through the real ingestion write, so the fixtures are honest. */
  async function seed(
    connectionId: string,
    rows: Array<{ id: string; status: string; createdAt?: string }>
  ) {
    for (const row of rows) {
      await returns.upsertFromObservation(
        connectionId,
        observation(row.id, row.status, row.createdAt) as never
      );
    }
  }

  it('should re-read only the NON-terminal returns', async () => {
    const connection = await allegroConnection();
    await seed(connection.id, [
      { id: 'r-open-1', status: 'DELIVERED' },
      { id: 'r-done-1', status: 'FINISHED' },
      { id: 'r-open-2', status: 'IN_TRANSIT' },
      { id: 'r-done-2', status: 'REJECTED' },
      // Not terminal on purpose: the parcel moved, the money did not.
      { id: 'r-open-3', status: 'WAREHOUSE_DELIVERED' },
    ]);

    const getReturn = jest.fn(async ({ externalReturnId }: { externalReturnId: string }) =>
      observation(externalReturnId, 'DELIVERED')
    );
    jest
      .spyOn(integrations, 'getCapabilityAdapter')
      .mockResolvedValue(mockReader(getReturn, TERMINAL) as never);

    const result = await sweep.sync(connection.id, { limit: 50 });

    expect(result).toMatchObject({ total: 3, scanned: 3, updated: 3, terminalVocabularyDeclared: true });
    const visited = getReturn.mock.calls.map((c) => c[0].externalReturnId).sort();
    expect(visited).toEqual(['r-open-1', 'r-open-2', 'r-open-3']);
  });

  it('should drop a return out of the candidate set once it goes terminal', async () => {
    const connection = await allegroConnection();
    await seed(connection.id, [{ id: 'r-1', status: 'DELIVERED' }]);

    jest.spyOn(integrations, 'getCapabilityAdapter').mockResolvedValue(
      mockReader(
        jest.fn().mockResolvedValue(observation('r-1', 'FINISHED')),
        TERMINAL
      ) as never
    );

    const first = await sweep.sync(connection.id, { limit: 50 });
    expect(first).toMatchObject({ total: 1, scanned: 1 });

    // Self-healing: the re-read persisted a terminal status, so the second run
    // finds nothing to do. No separate bookkeeping, no OL-side "closed" flag.
    const second = await sweep.sync(connection.id, { limit: 50 });
    expect(second).toMatchObject({ total: 0, scanned: 0, nextOffset: 0 });
  });

  it('should exclude returns older than the age bound', async () => {
    const connection = await allegroConnection();
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    await seed(connection.id, [
      { id: 'r-old', status: 'DELIVERED', createdAt: old },
      { id: 'r-recent', status: 'DELIVERED', createdAt: recent },
    ]);

    const getReturn = jest.fn(async ({ externalReturnId }: { externalReturnId: string }) =>
      observation(externalReturnId, 'DELIVERED')
    );
    jest
      .spyOn(integrations, 'getCapabilityAdapter')
      .mockResolvedValue(mockReader(getReturn, TERMINAL) as never);

    const result = await sweep.sync(connection.id, { limit: 50, lookbackDays: 90 });

    expect(result.total).toBe(1);
    expect(getReturn.mock.calls.map((c) => c[0].externalReturnId)).toEqual(['r-recent']);
  });

  it('should run — not error — when the adapter declares no terminal vocabulary', async () => {
    // The empty-list case is exactly where a naive `NOT IN ()` would be a
    // Postgres syntax error and take the whole sweep down.
    const connection = await allegroConnection();
    await seed(connection.id, [
      { id: 'r-1', status: 'DELIVERED' },
      { id: 'r-2', status: 'FINISHED' },
    ]);

    jest.spyOn(integrations, 'getCapabilityAdapter').mockResolvedValue(
      mockReader(
        jest.fn(async ({ externalReturnId }: { externalReturnId: string }) =>
          observation(externalReturnId, 'DELIVERED')
        ),
        undefined
      ) as never
    );

    const result = await sweep.sync(connection.id, { limit: 50 });

    // Degraded, not broken: both rows are candidates because nothing declared
    // which statuses mean "finished".
    expect(result).toMatchObject({ total: 2, scanned: 2, terminalVocabularyDeclared: false });
  });

  it('should continue the page past a 404 and count it', async () => {
    const connection = await allegroConnection();
    await seed(connection.id, [
      { id: 'r-1', status: 'DELIVERED' },
      { id: 'r-2', status: 'DELIVERED' },
      { id: 'r-3', status: 'DELIVERED' },
    ]);

    jest.spyOn(integrations, 'getCapabilityAdapter').mockResolvedValue(
      mockReader(
        jest.fn(async ({ externalReturnId }: { externalReturnId: string }) => {
          if (externalReturnId === 'r-2') {
            throw Object.assign(new Error('Not Found'), { statusCode: 404 });
          }
          return observation(externalReturnId, 'DELIVERED');
        }),
        TERMINAL
      ) as never
    );

    const result = await sweep.sync(connection.id, { limit: 50 });

    expect(result).toMatchObject({ scanned: 3, updated: 2, notFound: 1, failed: 0 });
  });

  it('should persist the scan offset through the handler and wrap at the end', async () => {
    const connection = await allegroConnection();
    await seed(connection.id, [
      { id: 'r-1', status: 'DELIVERED' },
      { id: 'r-2', status: 'DELIVERED' },
      { id: 'r-3', status: 'DELIVERED' },
    ]);

    jest.spyOn(integrations, 'getCapabilityAdapter').mockResolvedValue(
      mockReader(
        jest.fn(async ({ externalReturnId }: { externalReturnId: string }) =>
          observation(externalReturnId, 'DELIVERED')
        ),
        TERMINAL
      ) as never
    );

    const {
      MarketplaceReturnsStatusSyncHandler,
    } = require('../../src/sync/handlers/marketplace-returns-status-sync.handler');
    const handler = harness.get(MarketplaceReturnsStatusSyncHandler);
    const job = {
      id: 'job-sweep-1',
      jobType: 'marketplace.returns.statusSync',
      connectionId: connection.id,
      payload: { schemaVersion: 1, limit: 2, cursorKey: CURSOR_KEY, lookbackDays: 90 },
    };

    await handler.execute(job);
    expect(await cursors.get(connection.id, CURSOR_KEY)).toBe('2');

    // Second tick reads the remaining row and wraps back to the start.
    await handler.execute({ ...job, id: 'job-sweep-2' });
    expect(await cursors.get(connection.id, CURSOR_KEY)).toBe('0');
  });
});
