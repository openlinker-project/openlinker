/**
 * Price Change Episode Repository Integration Test (#3142, ADR-072)
 *
 * Vertical slice proving `upsertOpen`'s episode-pattern write against a real
 * Postgres (Testcontainers): the first detection opens a new episode, and a
 * second detection of the SAME key updates that same open row rather than
 * creating a duplicate — asserted against the real partial unique index
 * (`UQ_price_change_episodes_open`), not a mock.
 *
 * @module apps/api/test/integration
 */
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, teardownTestHarness } from './setup';
import {
  PRICE_CHANGE_EPISODE_REPOSITORY_TOKEN,
  type PriceChangeEpisodeRepositoryPort,
} from '@openlinker/core/listings';

const DEST_CONNECTION_ID = '44444444-4444-4444-8444-444444444444';
const SRC_CONNECTION_ID = '55555555-5555-4555-8555-555555555555';
const VARIANT_ID = 'ol_variant_price_change_1';

describe('Price Change Episode Repository Integration', () => {
  let harness: IntegrationTestHarness;
  let repository: PriceChangeEpisodeRepositoryPort;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness
      .getApp()
      .get<PriceChangeEpisodeRepositoryPort>(PRICE_CHANGE_EPISODE_REPOSITORY_TOKEN, {
        strict: false,
      });
  });

  afterEach(async () => {
    await harness.getDataSource().query('TRUNCATE TABLE "price_change_episodes"');
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const baseInput = {
    productVariantId: VARIANT_ID,
    destinationConnectionId: DEST_CONNECTION_ID,
    sourceConnectionId: SRC_CONNECTION_ID,
    sourceCurrency: 'PLN',
    blockReason: null,
    detectedAt: new Date('2026-09-10T10:00:00.000Z'),
  };

  it('opens a new episode on first detection', async () => {
    const { episode, wasRefresh } = await repository.upsertOpen({
      ...baseInput,
      sourceOldAmount: 350,
      sourceNewAmount: 327,
      computedOldAmount: 427,
      computedNewAmount: 399,
    });

    expect(wasRefresh).toBe(false);
    expect(episode.id).toBeDefined();
    expect(episode.isOpen()).toBe(true);
    expect(episode.sourceNewAmount).toBe(327);
    expect(episode.computedNewAmount).toBe(399);
    expect(episode.refreshedAt).toBeNull();
  });

  it('updates the SAME open row on re-detection, never a duplicate (#3, partial unique index)', async () => {
    const first = await repository.upsertOpen({
      ...baseInput,
      sourceOldAmount: 350,
      sourceNewAmount: 327,
      computedOldAmount: 427,
      computedNewAmount: 399,
    });

    const second = await repository.upsertOpen({
      ...baseInput,
      detectedAt: new Date('2026-09-10T11:00:00.000Z'),
      sourceOldAmount: 350,
      sourceNewAmount: 310, // price changed again before review
      computedOldAmount: 427,
      computedNewAmount: 378,
    });

    // Same id — the episode was refreshed, not duplicated.
    expect(second.episode.id).toBe(first.episode.id);
    expect(second.wasRefresh).toBe(true);
    expect(second.episode.sourceNewAmount).toBe(310);
    expect(second.episode.computedNewAmount).toBe(378);
    expect(second.episode.refreshedAt).not.toBeNull();

    const open = await repository.findOpenByKey(VARIANT_ID, DEST_CONNECTION_ID, SRC_CONNECTION_ID);
    expect(open?.id).toBe(first.episode.id);

    const all = await repository.findOpenForConnection(DEST_CONNECTION_ID);
    expect(all).toHaveLength(1);
  });

  it('opens a NEW episode after the previous one for the same key is resolved', async () => {
    const first = await repository.upsertOpen({
      ...baseInput,
      sourceOldAmount: 350,
      sourceNewAmount: 327,
      computedOldAmount: 427,
      computedNewAmount: 399,
    });

    const resolved = await repository.resolve(
      first.episode.id,
      'accepted',
      'user-1',
      null,
      new Date('2026-09-10T12:00:00.000Z')
    );
    expect(resolved).toBe(true);

    const second = await repository.upsertOpen({
      ...baseInput,
      detectedAt: new Date('2026-09-11T10:00:00.000Z'),
      sourceOldAmount: 327,
      sourceNewAmount: 300,
      computedOldAmount: 399,
      computedNewAmount: 365,
    });

    expect(second.wasRefresh).toBe(false);
    expect(second.episode.id).not.toBe(first.episode.id);
  });

  it('resolve() is guarded so a concurrent resolution cannot be overwritten', async () => {
    const { episode } = await repository.upsertOpen({
      ...baseInput,
      sourceOldAmount: 350,
      sourceNewAmount: 327,
      computedOldAmount: 427,
      computedNewAmount: 399,
    });

    const firstResolve = await repository.resolve(
      episode.id,
      'ignored',
      'user-1',
      null,
      new Date()
    );
    expect(firstResolve).toBe(true);

    const secondResolve = await repository.resolve(
      episode.id,
      'accepted',
      'user-2',
      null,
      new Date()
    );
    expect(secondResolve).toBe(false);

    const read = await repository.findById(episode.id);
    expect(read?.resolution).toBe('ignored');
  });

  it('reopenIgnored() re-opens an ignored episode but not an accepted one', async () => {
    const { episode } = await repository.upsertOpen({
      ...baseInput,
      sourceOldAmount: 350,
      sourceNewAmount: 327,
      computedOldAmount: 427,
      computedNewAmount: 399,
    });
    await repository.resolve(episode.id, 'ignored', 'user-1', null, new Date());

    const reopened = await repository.reopenIgnored(episode.id);
    expect(reopened).toBe(true);
    const read = await repository.findById(episode.id);
    expect(read?.isOpen()).toBe(true);

    await repository.resolve(episode.id, 'accepted', 'user-1', null, new Date());
    const reopenAcceptedAttempt = await repository.reopenIgnored(episode.id);
    expect(reopenAcceptedAttempt).toBe(false);
  });
});
