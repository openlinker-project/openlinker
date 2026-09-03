/**
 * Allegro Returns Sync E2E Integration Test (#2330)
 *
 * Poll → child → persisted aggregate, against real Postgres.
 *
 * The assertion that earns this file is the SECOND one: running the same child
 * twice converges on ONE row with its lines intact. Idempotency is what makes
 * the cursor-safety rule affordable — holding a cursor and re-reading a page is
 * only free if re-persisting is free — so if this ever regresses, the safe
 * behaviour in `allegro-returns-cursor-safety.int-spec.ts` becomes expensive
 * enough that someone will be tempted to remove it.
 *
 * @module apps/worker/test/integration
 */
import { DataSource } from 'typeorm';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { INTEGRATIONS_SERVICE_TOKEN, IIntegrationsService } from '@openlinker/core/integrations';
import {
  SYNC_JOB_QUEUE_TOKEN,
  SyncJobQueuePort,
} from '@openlinker/core/sync';
import {
  IReturnIngestionService,
  IReturnsService,
  RETURN_INGESTION_SERVICE_TOKEN,
  RETURNS_SERVICE_TOKEN,
} from '@openlinker/core/returns';
import {
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  IIdentifierMappingService,
  CORE_ENTITY_TYPE,
} from '@openlinker/core/identifier-mapping';

const RETURN_ID = 'a3405c27-b01c-4357-9bea-e13925708b46';
const ORDER_ID = 'b1105c27-b01c-4357-9bea-e13925708999';

function observation(overrides: Record<string, unknown> = {}) {
  return {
    externalReturnId: RETURN_ID,
    externalOrderId: ORDER_ID,
    referenceNumber: '1234/Z04A',
    rawStatus: 'DELIVERED',
    createdAt: '2026-01-11T09:36:57.000Z',
    isTerminalAtSource: false,
    buyerEmail: 'buyer@allegro.pl',
    marketplaceId: 'allegro-pl',
    lines: [
      {
        offerId: 'offer-1',
        name: 'Product one',
        quantity: 2,
        unitPrice: 123.45,
        reasonRaw: 'MISTAKE',
        serialNumbers: ['4CE0460D0G'],
      },
      {
        offerId: 'offer-2',
        name: 'Product two',
        quantity: 1,
        reasonRaw: 'DAMAGED',
      },
    ],
    ...overrides,
  };
}

function mockReader(getReturnImpl: jest.Mock) {
  return {
    listOrderFeed: jest.fn(),
    getOrder: jest.fn(),
    listReturnFeed: jest.fn().mockResolvedValue({
      items: [
        {
          externalReturnId: RETURN_ID,
          externalOrderId: ORDER_ID,
          occurredAt: '2026-01-11T09:36:57.000Z',
          eventKey: RETURN_ID,
        },
      ],
      nextCursor: RETURN_ID,
    }),
    getReturn: getReturnImpl,
    terminalRawStatuses: ['FINISHED', 'FINISHED_APT', 'REJECTED', 'COMMISSION_REFUNDED'],
  };
}

describe('Allegro Returns — poll → child → aggregate (#2330)', () => {
  let harness: WorkerIntegrationTestHarness;
  let dataSource: DataSource;
  let integrations: IIntegrationsService;
  let ingestion: IReturnIngestionService;
  let returns: IReturnsService;
  let identifierMapping: IIdentifierMappingService;
  let queue: SyncJobQueuePort;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    integrations = harness.get(INTEGRATIONS_SERVICE_TOKEN);
    ingestion = harness.get(RETURN_INGESTION_SERVICE_TOKEN);
    returns = harness.get(RETURNS_SERVICE_TOKEN);
    identifierMapping = harness.get(IDENTIFIER_MAPPING_SERVICE_TOKEN);
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

  async function countRows(table: string, where: string, params: unknown[]): Promise<number> {
    const rows = (await dataSource.query(
      `SELECT COUNT(*)::int AS c FROM "${table}" WHERE ${where}`,
      params
    )) as Array<{ c: number }>;
    return rows[0].c;
  }

  it('should fan out one child per feed item and persist the hydrated return', async () => {
    const connection = await allegroConnection();
    const getReturn = jest.fn().mockResolvedValue(observation());
    jest
      .spyOn(integrations, 'getCapabilityAdapter')
      .mockResolvedValue(mockReader(getReturn) as never);
    jest.spyOn(queue, 'enqueueBulk').mockResolvedValue(undefined as never);

    const poll = await ingestion.ingestReturns(connection.id, {
      cursorKey: 'allegro.customerReturns.lastReturnId',
      limit: 100,
    });
    expect(poll).toMatchObject({ fetched: 1, enqueued: 1, committed: true });

    const child = await ingestion.syncReturnFromSource(connection.id, RETURN_ID);

    const record = await returns.getReturn(child.returnId);
    expect(record).not.toBeNull();
    expect(record).toMatchObject({
      sourceConnectionId: connection.id,
      externalReturnId: RETURN_ID,
      origin: 'source_ingested',
      rawStatus: 'DELIVERED',
    });
    expect(record?.lines).toHaveLength(2);
    expect(record?.lines.map((l) => l.lineIndex)).toEqual([0, 1]);
    expect(record?.lines[0]).toMatchObject({ offerId: 'offer-1', quantityAdvised: 2 });
    // The rich fields with no column of their own survive in rawPayload rather
    // than being dropped.
    expect(record?.rawPayload).toMatchObject({
      referenceNumber: '1234/Z04A',
      buyerEmail: 'buyer@allegro.pl',
      isTerminalAtSource: false,
    });
  });

  it('should converge on ONE row when the same child runs twice', async () => {
    const connection = await allegroConnection();
    const getReturn = jest.fn().mockResolvedValue(observation());
    jest
      .spyOn(integrations, 'getCapabilityAdapter')
      .mockResolvedValue(mockReader(getReturn) as never);

    const first = await ingestion.syncReturnFromSource(connection.id, RETURN_ID);
    const second = await ingestion.syncReturnFromSource(connection.id, RETURN_ID);

    expect(second.returnId).toBe(first.returnId);
    expect(
      await countRows('returns', '"sourceConnectionId" = $1 AND "externalReturnId" = $2', [
        connection.id,
        RETURN_ID,
      ])
    ).toBe(1);
    // Lines converge too — a re-sync refreshes them in place rather than
    // appending a second copy of every parcel.
    expect(await countRows('return_lines', '"returnId" = $1', [first.returnId])).toBe(2);
  });

  it('should refresh the source-owned status on a re-sync', async () => {
    const connection = await allegroConnection();
    const getReturn = jest
      .fn()
      .mockResolvedValueOnce(observation({ rawStatus: 'DELIVERED' }))
      .mockResolvedValueOnce(observation({ rawStatus: 'FINISHED', isTerminalAtSource: true }));
    jest
      .spyOn(integrations, 'getCapabilityAdapter')
      .mockResolvedValue(mockReader(getReturn) as never);

    const first = await ingestion.syncReturnFromSource(connection.id, RETURN_ID);
    expect((await returns.getReturn(first.returnId))?.rawStatus).toBe('DELIVERED');

    await ingestion.syncReturnFromSource(connection.id, RETURN_ID);
    expect((await returns.getReturn(first.returnId))?.rawStatus).toBe('FINISHED');
  });

  it('should persist an unattributable return as a visible orphan, not a failure', async () => {
    const connection = await allegroConnection();
    jest
      .spyOn(integrations, 'getCapabilityAdapter')
      .mockResolvedValue(
        mockReader(jest.fn().mockResolvedValue(observation({ externalOrderId: null }))) as never
      );

    const result = await ingestion.syncReturnFromSource(connection.id, RETURN_ID);

    expect(result.attributed).toBe(false);
    const orphans = await returns.listOrphanReturns(10, 0);
    expect(orphans.map((o) => o.id)).toContain(result.returnId);
  });

  it('should attribute the return once OL knows the order', async () => {
    const connection = await allegroConnection();
    await identifierMapping.getOrCreateInternalId(CORE_ENTITY_TYPE.Order, ORDER_ID, connection.id);
    jest
      .spyOn(integrations, 'getCapabilityAdapter')
      .mockResolvedValue(mockReader(jest.fn().mockResolvedValue(observation())) as never);

    const result = await ingestion.syncReturnFromSource(connection.id, RETURN_ID);

    expect(result.attributed).toBe(true);
    const orphans = await returns.listOrphanReturns(10, 0);
    expect(orphans.map((o) => o.id)).not.toContain(result.returnId);
  });
});
