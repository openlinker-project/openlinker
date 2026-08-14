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
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { createTestOrderRecord } from './fixtures/order.fixtures';
import type { OrderRecordRepositoryPort } from '@openlinker/core/orders';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '@openlinker/core/orders';

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

  it('gives source_deleted the highest precedence — over awaiting_mapping, over failed (#1689)', async () => {
    await seedCanonicalSet(); // 7 records under SOURCE_A, none source_deleted
    const ds = harness.getDataSource();
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'source_deleted',
      syncStatus: [{ destinationConnectionId: DEST, status: 'failed', error: 'x' }],
    });

    const summary = await repository.countByHealth({ sourceConnectionId: SOURCE_A });

    expect(summary.sourceDeleted).toBe(1);
    // The 7 canonical records are unaffected — source_deleted precedence
    // pulls only the newly-seeded record out of needs_attention, not any of
    // the pre-existing failed rows.
    expect(summary.awaitingMapping).toBe(1);
    expect(summary.needsAttention).toBe(3);
    expect(summary.synced).toBe(1);
    expect(summary.awaitingDispatch).toBe(2);
    expect(summary.total).toBe(8);
    expect(
      summary.sourceDeleted +
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

  it('treats an unknown recordStatus as the residual awaiting_dispatch bucket (structural partition)', async () => {
    const ds = harness.getDataSource();
    // A hypothetical future recordStatus the bucket SQL doesn't name. The
    // residual `NOT awaiting_mapping` gating must still place it (and keep the
    // partition summing to total) — guards against #929's catch-all regressing.
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'archived',
      syncStatus: [],
    });
    await createTestOrderRecord(ds, {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'archived',
      syncStatus: [{ destinationConnectionId: DEST, status: 'failed', error: 'x' }],
    });

    const summary = await repository.countByHealth({});

    expect(summary.total).toBe(2);
    expect(summary.awaitingDispatch).toBe(1); // archived + empty → residual
    expect(summary.needsAttention).toBe(1); // archived + failed → not-mapping AND failed
    expect(
      summary.awaitingMapping +
        summary.needsAttention +
        summary.synced +
        summary.awaitingDispatch,
    ).toBe(summary.total);
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

  it('findMany filters to source_deleted, distinct from awaiting_mapping (#1689)', async () => {
    await seedCanonicalSet();
    await createTestOrderRecord(harness.getDataSource(), {
      sourceConnectionId: SOURCE_A,
      recordStatus: 'source_deleted',
      syncStatus: [{ destinationConnectionId: DEST, status: 'failed', error: 'x' }],
      mappingFailureReason: 'variant ol_variant_x deleted at the master',
    });

    const sourceDeleted = await repository.findMany(
      { health: 'source_deleted' },
      { limit: 50, offset: 0 },
    );
    expect(sourceDeleted.total).toBe(1);
    expect(sourceDeleted.items[0].recordStatus).toBe('source_deleted');
    expect(sourceDeleted.items[0].mappingFailureReason).toBe(
      'variant ol_variant_x deleted at the master',
    );

    const awaitingMapping = await repository.findMany(
      { health: 'awaiting_mapping' },
      { limit: 50, offset: 0 },
    );
    expect(awaitingMapping.total).toBe(1);
  });

  describe('sales-document block count + filter (#2100)', () => {
    it('counts blocked orders ORTHOGONALLY — the five health buckets still sum to the total', async () => {
      await seedCanonicalSet(); // 7 records, one of them `synced`
      const ds = harness.getDataSource();
      // Block the SYNCED order. This is the whole point of the orthogonality: an
      // order can be perfectly synced AND carry an invoicing block, so a sixth
      // health bucket would have had to either double-count it or steal it from
      // `synced` and hide its real sync state.
      const synced = await repository.findMany({ health: 'synced' }, { limit: 1, offset: 0 });
      await ds.query(
        `UPDATE "order_records" SET "salesDocumentBlockReason" = $1, "salesDocumentUnresolvedReason" = $2 WHERE "internalOrderId" = $3`,
        [
          'unresolved-routing',
          'ambiguous-connection-no-primary',
          synced.items[0].internalOrderId,
        ],
      );

      const summary = await repository.countByHealth({});

      expect(summary.salesDocumentBlocked).toBe(1);
      // Still counted as `synced` — not moved, not duplicated.
      expect(summary.synced).toBe(1);
      expect(summary.total).toBe(7);
      expect(
        summary.sourceDeleted +
          summary.awaitingMapping +
          summary.needsAttention +
          summary.synced +
          summary.awaitingDispatch,
      ).toBe(summary.total);
    });

    it('findMany composes the block filter with a health filter', async () => {
      await seedCanonicalSet();
      const ds = harness.getDataSource();
      const synced = await repository.findMany({ health: 'synced' }, { limit: 1, offset: 0 });
      await ds.query(
        `UPDATE "order_records" SET "salesDocumentBlockReason" = $1 WHERE "internalOrderId" = $2`,
        ['trigger-model-manual', synced.items[0].internalOrderId],
      );

      const blocked = await repository.findMany(
        { salesDocumentBlocked: true },
        { limit: 50, offset: 0 },
      );
      expect(blocked.total).toBe(1);
      expect(blocked.items[0].salesDocumentBlockReason).toBe('trigger-model-manual');

      // The two axes AND together — "synced AND invoicing blocked" is the shape an
      // operator actually asks for.
      const syncedAndBlocked = await repository.findMany(
        { health: 'synced', salesDocumentBlocked: true },
        { limit: 50, offset: 0 },
      );
      expect(syncedAndBlocked.total).toBe(1);

      const notBlocked = await repository.findMany(
        { salesDocumentBlocked: false },
        { limit: 50, offset: 0 },
      );
      expect(notBlocked.total).toBe(6);
    });

    it('reads back an unrecognised stored reason as null rather than leaking it', async () => {
      const ds = harness.getDataSource();
      const seeded = await createTestOrderRecord(ds, {
        sourceConnectionId: SOURCE_A,
        recordStatus: 'ready',
        syncStatus: [],
      });
      // The column is a plain varchar with no check constraint, so a value from a
      // newer release (or a hand edit) can land here. It must degrade to "no
      // block" instead of reaching the UI as a literal the badge cannot label.
      await ds.query(
        `UPDATE "order_records" SET "salesDocumentBlockReason" = $1 WHERE "internalOrderId" = $2`,
        ['some-future-reason', seeded.internalOrderId],
      );

      const found = await repository.findById(seeded.internalOrderId);

      expect(found?.salesDocumentBlockReason).toBeNull();
      // The FILTER still matches it — the row genuinely has a stored reason, and
      // hiding it from the count would under-report a real problem.
      const summary = await repository.countByHealth({});
      expect(summary.salesDocumentBlocked).toBe(1);
    });

    it('updateSalesDocumentBlock sets and clears without touching other columns', async () => {
      const ds = harness.getDataSource();
      const seeded = await createTestOrderRecord(ds, {
        sourceConnectionId: SOURCE_A,
        recordStatus: 'awaiting_mapping',
        mappingFailureReason: 'unresolved item ref',
        syncStatus: [{ destinationConnectionId: DEST, status: 'failed', error: 'x' }],
      });

      await repository.updateSalesDocumentBlock(seeded.internalOrderId, {
        reason: 'unresolved-routing',
        unresolvedReason: 'ambiguous-connection-no-primary',
        detail: '2 invoicing connections, none marked primary',
      });

      let found = await repository.findById(seeded.internalOrderId);
      expect(found?.salesDocumentBlockReason).toBe('unresolved-routing');
      expect(found?.salesDocumentUnresolvedReason).toBe('ambiguous-connection-no-primary');
      expect(found?.salesDocumentBlockDetail).toBe(
        '2 invoicing connections, none marked primary',
      );
      // Narrow absolute-set: the unrelated columns on the same row are untouched.
      expect(found?.recordStatus).toBe('awaiting_mapping');
      expect(found?.mappingFailureReason).toBe('unresolved item ref');

      // `null` clears all three — the level-triggered clear, and the ordinary path.
      await repository.updateSalesDocumentBlock(seeded.internalOrderId, null);

      found = await repository.findById(seeded.internalOrderId);
      expect(found?.salesDocumentBlockReason).toBeNull();
      expect(found?.salesDocumentUnresolvedReason).toBeNull();
      expect(found?.salesDocumentBlockDetail).toBeNull();
      expect(found?.recordStatus).toBe('awaiting_mapping');
    });

    it('upsert does NOT clear a block written by updateSalesDocumentBlock', async () => {
      const ds = harness.getDataSource();
      const seeded = await createTestOrderRecord(ds, {
        sourceConnectionId: SOURCE_A,
        recordStatus: 'ready',
        syncStatus: [],
      });
      await repository.updateSalesDocumentBlock(seeded.internalOrderId, {
        reason: 'trigger-model-manual',
      });

      const record = await repository.findById(seeded.internalOrderId);
      expect(record).not.toBeNull();
      // A re-ingestion re-persists the whole record. Because `toOrm` deliberately
      // omits these columns (the `cancelledAt` precedent), the save cannot stomp a
      // reason a concurrent transition just wrote.
      await repository.upsert(record!);

      const after = await repository.findById(seeded.internalOrderId);
      expect(after?.salesDocumentBlockReason).toBe('trigger-model-manual');
    });
  });
});
