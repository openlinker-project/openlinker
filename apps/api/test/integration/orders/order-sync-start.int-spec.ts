/**
 * Order Sync Start Int-Spec (#4265)
 *
 * The lifecycle of "where does order sync start" against real Postgres and
 * Redis, through the real services:
 *
 *   S1 - intent -> first poll seeds -> marker -> intent deleted. A connection is
 *        created over HTTP with a newest-first import; the first poll reads the
 *        source head, queues the history import, writes the cursor and the
 *        `.seededAt` marker, and deletes the intent.
 *   S2 - restarting twice at an UNCHANGED head produces two distinct import runs
 *        and neither first page is swallowed by the job dedupe key. Before the
 *        per-seed nonce, the second restart's page 1 collided with the first's.
 *   S3 - a restart while the poll holds its lock answers 409 ORDER_SYNC_BUSY and
 *        changes nothing (the intent is not stored, the cursors are not deleted).
 *
 * A fake `OrderSource` with `headCursor` and `listOrdersInWindow` is registered
 * through the same registry seam real adapters use, so `ConnectionService`,
 * `OrderIngestionService`, the cursor store, the lock and the job queue are all
 * the production ones. No worker runs in the API harness, so only page 1 of each
 * import chain exists; that is exactly the page the dedupe key can swallow.
 *
 * @module apps/api/test/integration/orders
 */
import type { RedisClientType } from 'redis';
import {
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  ADAPTER_REGISTRY_TOKEN,
  AdapterFactoryResolverService,
  AdapterRegistryPort,
} from '@openlinker/core/integrations';
import {
  ORDER_INGESTION_SERVICE_TOKEN,
  type IOrderIngestionService,
  type OrderFeedInput,
  type OrderFeedOutput,
  type OrderSourcePort,
  type OrderWindowInput,
  type OrderWindowPage,
} from '@openlinker/core/orders';
import {
  ORDER_SYNC_START_CURSOR_KEY,
  SYNC_CURSORS_SERVICE_TOKEN,
  SYNC_LOCK_TOKEN,
  orderFeedSeededAtCursorKey,
  type ISyncCursorsService,
  type SyncLockPort,
} from '@openlinker/core/sync';
import { REDIS_STREAM_NAMES } from '@openlinker/shared/redis';
import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
  type IntegrationTestHarness,
} from '../setup';
import { loginAsAdmin } from '../helpers/test-auth.helper';

const ADAPTER_KEY = 'test.ordersource.syncstart.v1';
const PLATFORM_TYPE = 'testshop';
const CURSOR_KEY = 'testshop.orders.feedCursor';
const HEAD = '00000042';

/** A shop whose newest order never changes, so every restart sees the same head. */
class FakeOrderSource implements OrderSourcePort {
  listOrderFeed(_input: OrderFeedInput): Promise<OrderFeedOutput> {
    return Promise.resolve({ items: [], nextCursor: null });
  }
  getOrder(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }
  headCursor(): Promise<string | null> {
    return Promise.resolve(HEAD);
  }
  listOrdersInWindow(_input: OrderWindowInput): Promise<OrderWindowPage> {
    return Promise.resolve({ items: [], nextCursor: null, done: true });
  }
}

interface QueuedImport {
  runId: string;
  idempotencyKey: string;
  page: number;
}

describe('Order sync start (#4265)', () => {
  let harness: IntegrationTestHarness;
  let ingestion: IOrderIngestionService;
  let cursors: ISyncCursorsService;
  let lock: SyncLockPort;
  let redis: RedisClientType;

  beforeAll(async () => {
    harness = await getTestHarness();
    const app = harness.getApp();
    ingestion = app.get<IOrderIngestionService>(ORDER_INGESTION_SERVICE_TOKEN);
    cursors = app.get<ISyncCursorsService>(SYNC_CURSORS_SERVICE_TOKEN);
    lock = app.get<SyncLockPort>(SYNC_LOCK_TOKEN);
    redis = app.get<RedisClientType>('REDIS_CLIENT');

    app.get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN).register({
      adapterKey: ADAPTER_KEY,
      platformType: PLATFORM_TYPE,
      supportedCapabilities: ['OrderSource'],
      orderSyncStartModes: ['now', 'from', 'all'],
      orderWindowImport: true,
      requiresCredentials: false,
      displayName: 'Order sync start test source',
      version: '0.0.0-test',
      isDefault: false,
    });
    app.get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN).registerFactory(ADAPTER_KEY, {
      createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(new FakeOrderSource() as unknown as T),
    });
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  async function adminToken(): Promise<string> {
    return loginAsAdmin(harness.getHttp(), harness.getDataSource());
  }

  async function createConnection(token: string): Promise<string> {
    const response = await harness
      .getHttp()
      .post('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Sync start test shop',
        platformType: PLATFORM_TYPE,
        adapterKey: ADAPTER_KEY,
        config: {},
        enabledCapabilities: ['OrderSource'],
        orderSyncStart: { mode: 'all', order: 'newest-first' },
      })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  function restart(token: string, connectionId: string): ReturnType<ReturnType<typeof harness.getHttp>['post']> {
    return harness
      .getHttp()
      .post(`/v1/connections/${connectionId}/order-sync/restart`)
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'all', order: 'newest-first' });
  }

  /** Every import page the queue holds for this connection, oldest first. */
  async function queuedImports(connectionId: string): Promise<QueuedImport[]> {
    const entries = await redis.xRange(REDIS_STREAM_NAMES.jobsSync, '-', '+');
    return entries
      .filter(
        (entry) =>
          entry.message.jobType === 'marketplace.orders.import' &&
          entry.message.connectionId === connectionId,
      )
      .map((entry) => {
        const payload = JSON.parse(entry.message.payloadJson) as { runId: string; page: number };
        return { runId: payload.runId, page: payload.page, idempotencyKey: entry.message.idempotencyKey };
      });
  }

  it('S1: seeds at the head on the first poll, queues the import, writes the marker and deletes the intent', async () => {
    const connectionId = await createConnection(await adminToken());
    expect(await cursors.getCursor(connectionId, ORDER_SYNC_START_CURSOR_KEY)).not.toBeNull();

    const result = await ingestion.ingestOrders(connectionId, { cursorKey: CURSOR_KEY, limit: 50 });

    expect(result.committed).toBe(true);
    expect(await cursors.getCursor(connectionId, CURSOR_KEY)).toBe(HEAD);
    expect(await cursors.getCursor(connectionId, orderFeedSeededAtCursorKey(CURSOR_KEY))).not.toBeNull();
    expect(await cursors.getCursor(connectionId, ORDER_SYNC_START_CURSOR_KEY)).toBeNull();
    const imports = await queuedImports(connectionId);
    expect(imports).toHaveLength(1);
    expect(imports[0].page).toBe(1);
    expect(imports[0].runId.startsWith(`start:${CURSOR_KEY}:${HEAD}:`)).toBe(true);

    // The intent is one-shot: a later poll reads the feed and queues nothing more.
    await ingestion.ingestOrders(connectionId, { cursorKey: CURSOR_KEY, limit: 50 });
    expect(await queuedImports(connectionId)).toHaveLength(1);
  });

  it('S2: two restarts at an unchanged head are two distinct runs and neither first page is swallowed', async () => {
    const token = await adminToken();
    const connectionId = await createConnection(token);
    await ingestion.ingestOrders(connectionId, { cursorKey: CURSOR_KEY, limit: 50 });

    await restart(token, connectionId).expect(200);
    await ingestion.ingestOrders(connectionId, { cursorKey: CURSOR_KEY, limit: 50 });
    await restart(token, connectionId).expect(200);
    await ingestion.ingestOrders(connectionId, { cursorKey: CURSOR_KEY, limit: 50 });

    const imports = await queuedImports(connectionId);
    expect(imports).toHaveLength(3);
    expect(new Set(imports.map((i) => i.runId)).size).toBe(3);
    expect(new Set(imports.map((i) => i.idempotencyKey)).size).toBe(3);
    expect(imports.every((i) => i.page === 1)).toBe(true);
    // Same head all three times: only the nonce tells the runs apart.
    expect(imports.every((i) => i.runId.includes(`:${HEAD}:`))).toBe(true);
  });

  it('S3: a restart while the poll holds its lock answers ORDER_SYNC_BUSY and changes nothing', async () => {
    const token = await adminToken();
    const connectionId = await createConnection(token);
    await ingestion.ingestOrders(connectionId, { cursorKey: CURSOR_KEY, limit: 50 });

    const lockKey = `marketplace:orders:poll:${connectionId}`;
    const held = await lock.acquire(lockKey, 30_000);
    expect(held).not.toBeNull();
    try {
      const refused = await restart(token, connectionId).expect(409);
      expect((refused.body as { code?: string }).code).toBe('ORDER_SYNC_BUSY');
      // Nothing moved: the intent was not stored and the feed position is intact.
      expect(await cursors.getCursor(connectionId, ORDER_SYNC_START_CURSOR_KEY)).toBeNull();
      expect(await cursors.getCursor(connectionId, CURSOR_KEY)).toBe(HEAD);
    } finally {
      await lock.release(lockKey, held!);
    }

    await restart(token, connectionId).expect(200);
    expect(await cursors.getCursor(connectionId, ORDER_SYNC_START_CURSOR_KEY)).not.toBeNull();
    expect(await cursors.getCursor(connectionId, CURSOR_KEY)).toBeNull();
  });
});
