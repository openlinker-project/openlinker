/**
 * Offer Status Snapshot Repository Integration Test (#816)
 *
 * Vertical slice covering the `offer_status_snapshots` persistence against a
 * real Postgres (Testcontainers): the upsert insert + in-place update paths,
 * keyed read round-trip (incl. the `jsonb` statusDetails + `timestamptz`
 * column), and the per-status count aggregation. Proves the ORM entity, the
 * repository mapping, and the Nest wiring of the new repository token.
 *
 * The status-sync service + worker handler logic is covered by their unit
 * specs; this test's job is the DB plumbing.
 *
 * @module apps/api/test/integration
 */
import { getTestHarness, IntegrationTestHarness, teardownTestHarness } from './setup';
import {
  OFFER_STATUS_SNAPSHOT_REPOSITORY_TOKEN,
  type OfferStatusSnapshotRepositoryPort,
} from '@openlinker/core/listings';

const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';

describe('Offer Status Snapshot Repository Integration', () => {
  let harness: IntegrationTestHarness;
  let repository: OfferStatusSnapshotRepositoryPort;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness
      .getApp()
      .get<OfferStatusSnapshotRepositoryPort>(OFFER_STATUS_SNAPSHOT_REPOSITORY_TOKEN, {
        strict: false,
      });
  });

  afterEach(async () => {
    await harness.getDataSource().query('TRUNCATE TABLE "offer_status_snapshots"');
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('inserts a snapshot and reads it back by (connectionId, externalOfferId)', async () => {
    const syncedAt = new Date('2026-05-23T10:00:00.000Z');

    const saved = await repository.upsert({
      connectionId: CONNECTION_ID,
      externalOfferId: '7781562863',
      internalVariantId: 'ol_variant_a',
      publicationStatus: 'active',
      statusDetails: { validationMessages: ['note'] },
      lastStatusSyncedAt: syncedAt,
    });

    expect(saved.snapshot.id).toBeDefined();
    expect(saved.previousStatus).toBeNull();

    const read = await repository.findByConnectionAndExternalOfferId(CONNECTION_ID, '7781562863');
    expect(read).not.toBeNull();
    expect(read?.publicationStatus).toBe('active');
    expect(read?.internalVariantId).toBe('ol_variant_a');
    expect(read?.statusDetails).toEqual({ validationMessages: ['note'] });
    expect(read?.lastStatusSyncedAt.toISOString()).toBe(syncedAt.toISOString());
  });

  it('updates the existing row in place on a second upsert of the same key', async () => {
    await repository.upsert({
      connectionId: CONNECTION_ID,
      externalOfferId: '999',
      internalVariantId: 'ol_variant_b',
      publicationStatus: 'active',
      statusDetails: null,
      lastStatusSyncedAt: new Date('2026-05-23T10:00:00.000Z'),
    });

    const updated = await repository.upsert({
      connectionId: CONNECTION_ID,
      externalOfferId: '999',
      internalVariantId: 'ol_variant_b',
      publicationStatus: 'ended',
      statusDetails: null,
      lastStatusSyncedAt: new Date('2026-05-23T11:00:00.000Z'),
    });

    expect(updated.previousStatus).toBe('active');

    const read = await repository.findByConnectionAndExternalOfferId(CONNECTION_ID, '999');
    expect(read?.id).toBe(updated.snapshot.id);
    expect(read?.publicationStatus).toBe('ended');

    const counts = await repository.countByConnectionAndStatus(CONNECTION_ID);
    expect(counts.get('ended')).toBe(1);
    expect(counts.get('active')).toBeUndefined();
  });

  it('aggregates counts per publication status for a connection', async () => {
    const base = {
      connectionId: CONNECTION_ID,
      internalVariantId: 'ol_variant_x',
      statusDetails: null,
      lastStatusSyncedAt: new Date('2026-05-23T10:00:00.000Z'),
    };
    await repository.upsert({ ...base, externalOfferId: 'a', publicationStatus: 'active' });
    await repository.upsert({ ...base, externalOfferId: 'b', publicationStatus: 'active' });
    await repository.upsert({ ...base, externalOfferId: 'c', publicationStatus: 'inactive' });

    const counts = await repository.countByConnectionAndStatus(CONNECTION_ID);
    expect(counts.get('active')).toBe(2);
    expect(counts.get('inactive')).toBe(1);
  });
});
