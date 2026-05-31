/**
 * Order Health Summary Integration Test (#929)
 *
 * Exercises the real `OrderRecordRepository.countByHealth` and the `health`
 * filter on `findMany` against Testcontainers Postgres — the only reliable
 * cover for the JSONB `@>` containment + `CASE`/`FILTER` SQL that derives the
 * health buckets. Asserts the canonical precedence (notably failed+synced →
 * needs_attention and awaiting_mapping over a failed sync), the partition
 * invariant (buckets sum to total), and the source-scope filter.
 *
 * @module apps/api/test/integration
 */
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { createTestOrderRecord } from './fixtures/order.fixtures';
import {
  ORDER_RECORD_REPOSITORY_TOKEN,
  OrderRecordRepositoryPort,
} from '@openlinker/core/orders';

const SOURCE_A = '11111111-1111-4111-8111-111111111111';
const SOURCE_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEST = '22222222-2222-4222-8222-222222222222';
const DEST2 = '33333333-3333-4333-8333-333333333333';

describe('Order health summary (integration)', () => {
  let harness: IntegrationTestHarness;
  let repository: OrderRecordRepositoryPort;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness.getApp().get<OrderRecordRepositoryPort>(ORDER_RECORD_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  /** Seed the seven canonical SOURCE_A records covering every bucket + precedence. */
  async function seedCanonicalSet(): Promise<void> {
    const ds = harness.getDataSource();
    // awaiting_mapping — wins even with a failed sync (precedence rule 1).
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'awaiting_mapping',
      syncStatus: [{ destinationConnectionId: DEST, status: 'failed', error: 'x' }],
    });
    // needs_attention — ready + failed (×2).
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      syncStatus: [{ destinationConnectionId: DEST, status: 'failed', error: 'x' }],
    });
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      syncStatus: [{ destinationConnectionId: DEST, status: 'failed', error: 'x' }],
    });
    // needs_attention — failed wins over synced (precedence rule 2 over 3).
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      syncStatus: [
        { destinationConnectionId: DEST, status: 'synced' },
        { destinationConnectionId: DEST2, status: 'failed', error: 'x' },
      ],
    });
    // synced — ready, no failed, a destination synced.
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      syncStatus: [{ destinationConnectionId: DEST, status: 'synced' }],
    });
    // awaiting_dispatch — empty syncStatus.
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      syncStatus: [],
    });
    // awaiting_dispatch — only pending.
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'ready',
      syncStatus: [{ destinationConnectionId: DEST, status: 'pending' }],
    });
  }

  it('partitions records into health buckets that sum to the total', async () => {
    await seedCanonicalSet();

    const summary = await repository.countByHealth({});

    expect(summary.awaitingMapping).toBe(1);
    expect(summary.needsAttention).toBe(3); // 2 failed + 1 failed-beats-synced
    expect(summary.synced).toBe(1);
    expect(summary.awaitingDispatch).toBe(2); // empty + pending
    expect(summary.total).toBe(7);
    expect(
      summary.awaitingMapping +
        summary.needsAttention +
        summary.synced +
        summary.awaitingDispatch,
    ).toBe(summary.total);
  });

  it('scopes the counts to a single source connection', async () => {
    await seedCanonicalSet(); // 7 under SOURCE_A
    await createTestOrderRecord(harness.getDataSource(), {
      sourceConnectionId: SOURCE_B,
      recordStatus: 'ready',
      syncStatus: [{ destinationConnectionId: DEST, status: 'failed', error: 'x' }],
    });

    const all = await repository.countByHealth({});
    expect(all.total).toBe(8);
    expect(all.needsAttention).toBe(4);

    const scoped = await repository.countByHealth({ sourceConnectionId: SOURCE_A });
    expect(scoped.total).toBe(7);
    expect(scoped.needsAttention).toBe(3);
  });

  it('findMany filters to a single health bucket', async () => {
    await seedCanonicalSet();

    const needsAttention = await repository.findMany(
      { health: 'needs_attention' },
      { limit: 50, offset: 0 },
    );
    expect(needsAttention.total).toBe(3);

    const awaitingDispatch = await repository.findMany(
      { health: 'awaiting_dispatch' },
      { limit: 50, offset: 0 },
    );
    expect(awaitingDispatch.total).toBe(2);

    const awaitingMapping = await repository.findMany(
      { health: 'awaiting_mapping' },
      { limit: 50, offset: 0 },
    );
    expect(awaitingMapping.total).toBe(1);
    expect(awaitingMapping.items[0].recordStatus).toBe('awaiting_mapping');
  });
});
