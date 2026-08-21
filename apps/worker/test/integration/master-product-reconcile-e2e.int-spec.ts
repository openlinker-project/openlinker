/**
 * Master Product Reconcile End-to-End Integration Test (#2222)
 *
 * Covers the deletion authority's fan-out against a real Postgres + Redis harness:
 *
 * 1. It enumerates OL's OWN `Product` identifier mappings — not a master catalog.
 *    This is the inversion the whole pass exists for: a catalog enumeration cannot
 *    reveal a deletion, because the deleted record simply stops appearing.
 * 2. It enqueues the EXISTING `master.product.syncByExternalId`, so the adapter's
 *    404 stays the authority and this handler never writes staleness itself.
 * 3. Synthetic variant ids are filtered, and the cursor still advances by rows READ.
 * 4. A mapping set larger than one budget resumes across ticks and then completes.
 *
 * Worth having as an int-spec rather than only a unit test: worker int-specs are the
 * only place the real DI graph, the real cursor repository and the real job
 * repository are exercised together, and `pnpm lint` / `pnpm type-check` exclude
 * `apps/worker/test` — so this file is compile-checked only when it runs.
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import {
  SYNC_JOB_REPOSITORY_TOKEN,
  JOB_ENQUEUE_TOKEN,
  SYNC_CURSORS_SERVICE_TOKEN,
  SyncJobRequest,
  JobEnqueuePort,
  ISyncCursorsService,
} from '@openlinker/core/sync';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

describe('Master Product Reconcile End-to-End Integration (#2222)', () => {
  let harness: WorkerIntegrationTestHarness;
  // Structurally typed to the ONE method this spec uses, rather than importing
  // `SyncJobRepositoryPort`: a repository port is an intra-context contract and
  // `check-cross-context-imports` denies it by shape. The sibling inventory
  // int-spec predates that rule and is allow-listed; a new file should not add
  // another entry to unwind later.
  let jobRepository: {
    createIfNotExistsByIdempotencyKey(input: {
      jobType: string;
      connectionId: string;
      payload: unknown;
      idempotencyKey: string;
      maxAttempts: number;
    }): Promise<unknown>;
  };
  let jobEnqueue: JobEnqueuePort;
  let cursors: ISyncCursorsService;
  let dataSource: DataSource;

  beforeAll(async () => {
    harness = await getTestHarness();
    jobRepository = harness.get(SYNC_JOB_REPOSITORY_TOKEN);
    jobEnqueue = harness.get(JOB_ENQUEUE_TOKEN);
    cursors = harness.get(SYNC_CURSORS_SERVICE_TOKEN);
    dataSource = harness.getDataSource();
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

  async function seedProductMappings(
    connectionId: string,
    platformType: string,
    externalIds: string[]
  ): Promise<void> {
    const repo = dataSource.getRepository(IdentifierMappingOrmEntity);
    for (const externalId of externalIds) {
      await repo.save(
        repo.create({
          entityType: 'Product',
          internalId: `ol_product_${randomUUID().replace(/-/g, '')}`,
          externalId,
          platformType,
          connectionId,
          context: null,
        })
      );
    }
  }

  async function runReconcile(
    connectionId: string,
    payload: Record<string, unknown> = {}
  ): Promise<void> {
    const request: SyncJobRequest = {
      jobType: 'master.product.reconcile',
      connectionId,
      payload: { schemaVersion: 1, ...payload },
      idempotencyKey: `product-reconcile-${randomUUID()}`,
    };
    const outerJob = await jobRepository.createIfNotExistsByIdempotencyKey({
      jobType: request.jobType,
      connectionId: request.connectionId,
      payload: request.payload,
      idempotencyKey: request.idempotencyKey,
      maxAttempts: 3,
    });

    const {
      MasterProductReconcileHandler,
    } = require('../../src/sync/handlers/master-product-reconcile.handler');
    const handler = harness.get(MasterProductReconcileHandler);
    await handler.execute(outerJob);
  }

  const newConnection = () =>
    createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
      credentialsRef: 'test-credentials-ref',
      adapterKey: 'prestashop.webservice.v1',
    });

  it("re-checks every mapped product by id, from OL's own mappings", async () => {
    const connection = await newConnection();
    const externalIds = ['ext-1', 'ext-2', 'ext-3'];
    await seedProductMappings(connection.id, 'prestashop', externalIds);

    const enqueueSpy = jest.spyOn(jobEnqueue, 'enqueueJob');
    await runReconcile(connection.id);

    const children = enqueueSpy.mock.calls.filter(
      ([req]) => req.jobType === 'master.product.syncByExternalId'
    );
    expect(children).toHaveLength(externalIds.length);
    expect(
      children.map(([req]) => (req.payload as { externalId: string }).externalId).sort()
    ).toEqual([...externalIds].sort());

    // The authority stays with the child. This pass must never enqueue anything
    // else — in particular nothing that writes staleness directly.
    const enqueuedTypes = new Set(enqueueSpy.mock.calls.map(([req]) => req.jobType));
    expect(enqueuedTypes).toEqual(new Set(['master.product.syncByExternalId']));
  });

  it('skips synthetic variant mappings but still advances the cursor past them', async () => {
    // `product:NN` mappings resolve to a VARIANT internal id, so re-checking them
    // as products would resolve the wrong entity. Advancing by survivors rather
    // than by rows read would re-read them on every tick, forever.
    const connection = await newConnection();
    await seedProductMappings(connection.id, 'prestashop', [
      'product:10',
      'product:11',
      'product:12',
    ]);

    const enqueueSpy = jest.spyOn(jobEnqueue, 'enqueueJob');
    await runReconcile(connection.id, { pageLimit: 3 });

    expect(
      enqueueSpy.mock.calls.filter(([req]) => req.jobType === 'master.product.syncByExternalId')
    ).toHaveLength(0);

    const cursor = await cursors.getCursor(
      connection.id,
      `master.product-reconcile.sweep:connection:${connection.id}`
    );
    expect(cursor).toEqual(expect.stringContaining(':3'));
  });

  it('resumes across ticks and completes the cycle', async () => {
    const connection = await newConnection();
    const externalIds = Array.from({ length: 5 }, (_, i) => `ext-${String(i)}`);
    await seedProductMappings(connection.id, 'prestashop', externalIds);

    const cursorKey = `master.product-reconcile.sweep:connection:${connection.id}`;
    const enqueueSpy = jest.spyOn(jobEnqueue, 'enqueueJob');

    await runReconcile(connection.id, { pageLimit: 2 });
    expect(await cursors.getCursor(connection.id, cursorKey)).toEqual(
      expect.stringContaining(':2')
    );

    await runReconcile(connection.id, { pageLimit: 2 });
    await runReconcile(connection.id, { pageLimit: 2 });

    // Cycle complete ⇒ the cursor is cleared, which is how every sweep in this
    // family signals completion.
    expect(await cursors.getCursor(connection.id, cursorKey) ?? '').toBe('');

    const seen = new Set(
      enqueueSpy.mock.calls
        .filter(([req]) => req.jobType === 'master.product.syncByExternalId')
        .map(([req]) => (req.payload as { externalId: string }).externalId)
    );
    expect([...seen].sort()).toEqual([...externalIds].sort());
  });

  it('enqueues nothing for a connection with no product mappings', async () => {
    // An empty enumeration is not "everything was deleted" — it simply has
    // nothing to re-check, which is why this pass needs no zero-observation guard.
    const connection = await newConnection();

    const enqueueSpy = jest.spyOn(jobEnqueue, 'enqueueJob');
    await runReconcile(connection.id);

    expect(
      enqueueSpy.mock.calls.filter(([req]) => req.jobType === 'master.product.syncByExternalId')
    ).toHaveLength(0);
  });
});
