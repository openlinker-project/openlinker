/**
 * Identifier Mapping Concurrency Integration Spec
 *
 * Real-DB regression test for issue #656 (concurrency race in
 * `getOrCreateInternalId`). Complements the unit spec, which only proves the
 * application-layer recovery given a stubbed `DuplicateIdentifierMappingError`.
 * This spec exercises the full seam: the repository's PG `23505` →
 * `DuplicateIdentifierMappingError` translation against a real Postgres
 * unique index, plus the service's insert-then-recover convergence under
 * concurrent insert load.
 *
 * @module apps/api/test/integration/identifier-mapping
 */
import { DataSource } from 'typeorm';
import {
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
  IntegrationTestHarness,
} from '../setup';
import { createTestConnection } from '../helpers/test-connection.helper';

describe('IdentifierMappingService — concurrency (real Postgres)', () => {
  let harness: IntegrationTestHarness;
  let dataSource: DataSource;
  let service: IIdentifierMappingService;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    service = harness.getApp().get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN);
  }, 60_000);

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('converges on a single mapping row when N callers race on the same external key', async () => {
    const connection = await createTestConnection(dataSource);
    const N = 16;

    const results = await Promise.all(
      Array.from({ length: N }, () =>
        service.getOrCreateInternalId('Product', 'external-race', connection.id),
      ),
    );

    // Every caller resolves to the same internalId.
    const unique = new Set(results);
    expect(unique.size).toBe(1);
    expect(results[0]).toMatch(/^ol_product_[a-f0-9]{32}$/);

    // Exactly one row persists in the database for the external key.
    const mappings = await dataSource.getRepository(IdentifierMappingOrmEntity).find({
      where: {
        entityType: 'Product',
        connectionId: connection.id,
        externalId: 'external-race',
      },
    });
    expect(mappings).toHaveLength(1);
    expect(mappings[0].internalId).toBe(results[0]);
  });

  it('isolates races per (entityType, externalId, connectionId) triple', async () => {
    const connection = await createTestConnection(dataSource);
    const externalIds = ['ext-a', 'ext-b', 'ext-c'];
    const callersPerKey = 6;

    const calls = externalIds.flatMap((externalId) =>
      Array.from({ length: callersPerKey }, () => ({
        externalId,
        promise: service.getOrCreateInternalId('Product', externalId, connection.id),
      })),
    );

    const resolved = await Promise.all(calls.map(({ externalId, promise }) => promise.then((id) => ({ externalId, id }))));

    // Each externalId produced exactly one internalId across its callers.
    const idByExternal = new Map<string, Set<string>>();
    for (const { externalId, id } of resolved) {
      const set = idByExternal.get(externalId) ?? new Set<string>();
      set.add(id);
      idByExternal.set(externalId, set);
    }
    for (const externalId of externalIds) {
      expect(idByExternal.get(externalId)?.size).toBe(1);
    }

    // The three external keys minted three distinct internal IDs.
    const distinctInternalIds = new Set(resolved.map((r) => r.id));
    expect(distinctInternalIds.size).toBe(externalIds.length);

    // The database carries exactly three rows.
    const mappings = await dataSource.getRepository(IdentifierMappingOrmEntity).find({
      where: { entityType: 'Product', connectionId: connection.id },
    });
    expect(mappings).toHaveLength(externalIds.length);
  });
});
