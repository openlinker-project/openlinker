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

  it('reopenIgnored() refuses (returns false, never throws) when a newer episode already claims the key — ignore → detect → unresolve', async () => {
    // Operator ignores episode E.
    const { episode: e } = await repository.upsertOpen({
      ...baseInput,
      sourceOldAmount: 350,
      sourceNewAmount: 327,
      computedOldAmount: 427,
      computedNewAmount: 399,
    });
    await repository.resolve(e.id, 'ignored', 'user-1', null, new Date('2026-09-10T11:00:00.000Z'));

    // E leaves the open index, so a later detection opens a FRESH episode F
    // for the same key rather than refreshing E (this PR's own earlier test
    // proves a resolved row frees the key).
    const { episode: f, wasRefresh } = await repository.upsertOpen({
      ...baseInput,
      detectedAt: new Date('2026-09-10T12:00:00.000Z'),
      sourceOldAmount: 327,
      sourceNewAmount: 300,
      computedOldAmount: 399,
      computedNewAmount: 365,
    });
    expect(wasRefresh).toBe(false);
    expect(f.id).not.toBe(e.id);

    // The operator only now clicks Undo on E — refused, not a raw 23505.
    const reopenResult = await repository.reopenIgnored(e.id);
    expect(reopenResult).toBe(false);

    // E stays resolved; F stays the one open episode for the key.
    const readE = await repository.findById(e.id);
    expect(readE?.isOpen()).toBe(false);
    const openForKey = await repository.findOpenByKey(
      VARIANT_ID,
      DEST_CONNECTION_ID,
      SRC_CONNECTION_ID
    );
    expect(openForKey?.id).toBe(f.id);
  });

  it('upsertOpen() only stamps refreshedAt when the re-detected sourceNewAmount actually differs', async () => {
    const first = await repository.upsertOpen({
      ...baseInput,
      sourceOldAmount: 350,
      sourceNewAmount: 327,
      computedOldAmount: 427,
      computedNewAmount: 399,
    });
    expect(first.episode.refreshedAt).toBeNull();

    // A re-detection reporting the SAME sourceNewAmount (e.g. the same source
    // price re-observed on the next poll) is a conflict-arm write
    // (wasRefresh: true) but must NOT stamp refreshedAt — nothing changed.
    const repeated = await repository.upsertOpen({
      ...baseInput,
      detectedAt: new Date('2026-09-10T11:00:00.000Z'),
      sourceOldAmount: 350,
      sourceNewAmount: 327,
      computedOldAmount: 427,
      computedNewAmount: 399,
    });
    expect(repeated.wasRefresh).toBe(true);
    expect(repeated.episode.refreshedAt).toBeNull();

    // A re-detection reporting a genuinely DIFFERENT sourceNewAmount stamps it.
    const changed = await repository.upsertOpen({
      ...baseInput,
      detectedAt: new Date('2026-09-10T12:00:00.000Z'),
      sourceOldAmount: 350,
      sourceNewAmount: 310,
      computedOldAmount: 427,
      computedNewAmount: 378,
    });
    expect(changed.wasRefresh).toBe(true);
    expect(changed.episode.refreshedAt).not.toBeNull();
  });

  it('countOpen() / countOpenBySource() report real counts without materialising every row', async () => {
    const otherSourceId = '66666666-6666-4666-8666-666666666666';
    await repository.upsertOpen({
      ...baseInput,
      sourceOldAmount: 350,
      sourceNewAmount: 327,
      computedOldAmount: 427,
      computedNewAmount: 399,
    });
    await repository.upsertOpen({
      ...baseInput,
      productVariantId: 'ol_variant_price_change_2',
      sourceConnectionId: otherSourceId,
      sourceOldAmount: 100,
      sourceNewAmount: 90,
      computedOldAmount: 120,
      computedNewAmount: 108,
    });

    expect(await repository.countOpen()).toBe(2);
    expect(await repository.countOpen({ destinationConnectionId: DEST_CONNECTION_ID })).toBe(2);
    expect(
      await repository.countOpen({
        destinationConnectionId: DEST_CONNECTION_ID,
        sourceConnectionId: otherSourceId,
      })
    ).toBe(1);

    const bySource = await repository.countOpenBySource(DEST_CONNECTION_ID);
    expect(bySource.get(SRC_CONNECTION_ID)).toBe(1);
    expect(bySource.get(otherSourceId)).toBe(1);
    expect(bySource.has('no-such-source')).toBe(false);
  });

  it('round-trips a null computedOldAmount (a brand-new mapping with no baseline) and excludes it from direction filtering (#3159 review)', async () => {
    const { episode } = await repository.upsertOpen({
      ...baseInput,
      sourceOldAmount: 430.5,
      sourceNewAmount: 430.5,
      computedOldAmount: null,
      computedNewAmount: 430.5,
    });

    expect(episode.computedOldAmount).toBeNull();
    expect(episode.deltaPct()).toBeNull();
    expect(episode.isSteep()).toBe(false);

    const read = await repository.findById(episode.id);
    expect(read?.computedOldAmount).toBeNull();

    // An unknown direction matches neither 'up' nor 'down' — never defaults
    // to 'down' the way `computedOldAmount === 0` used to.
    expect(await repository.findOpenForConnection(DEST_CONNECTION_ID, { direction: 'up' })).toEqual(
      []
    );
    expect(
      await repository.findOpenForConnection(DEST_CONNECTION_ID, { direction: 'down' })
    ).toEqual([]);
    expect(await repository.findOpenForConnection(DEST_CONNECTION_ID)).toHaveLength(1);

    // The `direction: 'unknown'` filter (#3159 review, stack note) DOES match
    // it — the three-valued behaviour is now a three-valued type.
    expect(
      await repository.findOpenForConnection(DEST_CONNECTION_ID, { direction: 'unknown' })
    ).toHaveLength(1);
  });

  it('round-trips a null sourceOldAmount (no prior source price at all) instead of fabricating old = new (#3159 review, BLOCKING)', async () => {
    const { episode } = await repository.upsertOpen({
      ...baseInput,
      sourceOldAmount: null,
      sourceNewAmount: 430.5,
      computedOldAmount: null,
      computedNewAmount: 430.5,
    });

    expect(episode.sourceOldAmount).toBeNull();

    const read = await repository.findById(episode.id);
    expect(read?.sourceOldAmount).toBeNull();
  });

  it('classifies a real zero baseline as an increase, not "down" (#3159 review)', async () => {
    // A previously-free product (`computedOldAmount: 0`) that now carries a
    // price. `deltaPct()` returns `0` here to avoid a `NaN`/`Infinity`
    // percentage, but the DIRECTION must still read as an increase.
    const { episode } = await repository.upsertOpen({
      ...baseInput,
      sourceOldAmount: 0,
      sourceNewAmount: 100,
      computedOldAmount: 0,
      computedNewAmount: 100,
    });

    expect(episode.direction()).toBe('up');
    expect(episode.deltaPct()).toBe(0);

    expect(
      await repository.findOpenForConnection(DEST_CONNECTION_ID, { direction: 'up' })
    ).toHaveLength(1);
    expect(
      await repository.findOpenForConnection(DEST_CONNECTION_ID, { direction: 'down' })
    ).toEqual([]);
  });

  it('findByIds() batches lookups and omits ids with no matching row (#3162 review)', async () => {
    const first = await repository.upsertOpen({
      ...baseInput,
      sourceOldAmount: 350,
      sourceNewAmount: 327,
      computedOldAmount: 427,
      computedNewAmount: 399,
    });
    const second = await repository.upsertOpen({
      ...baseInput,
      productVariantId: 'ol_variant_price_change_2',
      sourceOldAmount: 100,
      sourceNewAmount: 90,
      computedOldAmount: 120,
      computedNewAmount: 108,
    });

    const found = await repository.findByIds([first.episode.id, second.episode.id, 'no-such-id']);
    expect(found.map((e) => e.id).sort()).toEqual(
      [first.episode.id, second.episode.id].sort()
    );

    expect(await repository.findByIds([])).toEqual([]);
  });

  it('findOpenForConnection()/findOpenAll() apply limit/offset as a real SQL page (#3162 review)', async () => {
    for (let i = 0; i < 5; i++) {
      await repository.upsertOpen({
        ...baseInput,
        productVariantId: `ol_variant_price_change_page_${i}`,
        detectedAt: new Date(`2026-09-10T${10 + i}:00:00.000Z`),
        sourceOldAmount: 100,
        sourceNewAmount: 90,
        computedOldAmount: 120,
        computedNewAmount: 108,
      });
    }

    const firstPage = await repository.findOpenForConnection(DEST_CONNECTION_ID, { limit: 2 });
    expect(firstPage).toHaveLength(2);

    const secondPage = await repository.findOpenForConnection(DEST_CONNECTION_ID, {
      limit: 2,
      offset: 2,
    });
    expect(secondPage).toHaveLength(2);
    expect(secondPage.map((e) => e.id)).not.toEqual(firstPage.map((e) => e.id));

    // ORDER BY detectedAt DESC (most recently detected first) — the last
    // upserted row (i=4) is the newest and must lead the first page.
    expect(firstPage[0].productVariantId).toBe('ol_variant_price_change_page_4');

    expect(await repository.findOpenAll({ limit: 100 })).toHaveLength(5);
  });

  it('includeRecentlyResolved surfaces a just-ignored episode so Undo is reachable (#3162 review)', async () => {
    const { episode } = await repository.upsertOpen({
      ...baseInput,
      sourceOldAmount: 350,
      sourceNewAmount: 327,
      computedOldAmount: 427,
      computedNewAmount: 399,
    });
    await repository.resolve(episode.id, 'ignored', 'user-1', null, new Date());

    // Without the flag, an ignored episode is invisible to the list read —
    // this is the previously-shipped, still-correct behaviour for a badge
    // count and for a caller that only wants ACTIONABLE rows.
    expect(await repository.findOpenForConnection(DEST_CONNECTION_ID)).toEqual([]);

    // With it, the just-ignored row is surfaced, `resolution` intact —
    // giving a caller (`PriceChangesService.listOpen`) something to render
    // an Undo affordance against at all.
    const withRecent = await repository.findOpenForConnection(DEST_CONNECTION_ID, {
      includeRecentlyResolved: true,
    });
    expect(withRecent).toHaveLength(1);
    expect(withRecent[0].id).toBe(episode.id);
    expect(withRecent[0].resolution).toBe('ignored');

    // A PLAIN badge counter (no `includeRecentlyResolved`) must stay
    // strictly "open" — it never includes a resolved row.
    expect(await repository.countOpen({ destinationConnectionId: DEST_CONNECTION_ID })).toBe(0);

    // With `includeRecentlyResolved` — the SAME flag the list read passes
    // when computing its `total` — `countOpen` counts over the IDENTICAL
    // predicate `findOpenForConnection` paged from (#3162 re-review,
    // IMPORTANT: "`total`, `items` and `hiddenStaleCount` describe three
    // different sets" — a page rendering this row must be matched by a
    // total that counts it, or a caller reading "N of M" sees a page with
    // more visible rows than the M it was told to expect).
    expect(
      await repository.countOpen({
        destinationConnectionId: DEST_CONNECTION_ID,
        includeRecentlyResolved: true,
      })
    ).toBe(1);
  });

  it('acknowledgeRefresh() clears refreshedAt on an OPEN episode and no-ops on a resolved one (#3162 review)', async () => {
    const first = await repository.upsertOpen({
      ...baseInput,
      sourceOldAmount: 350,
      sourceNewAmount: 327,
      computedOldAmount: 427,
      computedNewAmount: 399,
    });
    const refreshed = await repository.upsertOpen({
      ...baseInput,
      detectedAt: new Date('2026-09-10T11:00:00.000Z'),
      sourceOldAmount: 350,
      sourceNewAmount: 310,
      computedOldAmount: 427,
      computedNewAmount: 378,
    });
    expect(refreshed.episode.refreshedAt).not.toBeNull();

    const acknowledged = await repository.acknowledgeRefresh(first.episode.id);
    expect(acknowledged?.refreshedAt).toBeNull();

    const read = await repository.findById(first.episode.id);
    expect(read?.refreshedAt).toBeNull();

    // A resolved episode's `refreshedAt` is historical, not actionable —
    // acknowledgeRefresh must not touch it and must report `null`.
    await repository.resolve(first.episode.id, 'ignored', 'user-1', null, new Date());
    const onResolved = await repository.acknowledgeRefresh(first.episode.id);
    expect(onResolved).toBeNull();

    expect(await repository.acknowledgeRefresh('no-such-id')).toBeNull();
  });

  it('direction/magnitudeLargeOnly are real SQL predicates — the page and the total agree, and a limited page never under-fills (#3162 re-review, BLOCKING)', async () => {
    // Two 'up' episodes and one 'down' episode for the SAME destination.
    await repository.upsertOpen({
      ...baseInput,
      productVariantId: 'ol_variant_price_change_up_1',
      detectedAt: new Date('2026-09-10T10:00:00.000Z'),
      sourceOldAmount: 100,
      sourceNewAmount: 130,
      computedOldAmount: 100,
      computedNewAmount: 130, // +30% — steep AND up
    });
    await repository.upsertOpen({
      ...baseInput,
      productVariantId: 'ol_variant_price_change_up_2',
      detectedAt: new Date('2026-09-10T11:00:00.000Z'),
      sourceOldAmount: 100,
      sourceNewAmount: 101,
      computedOldAmount: 100,
      computedNewAmount: 101, // +1% — up, NOT steep
    });
    await repository.upsertOpen({
      ...baseInput,
      productVariantId: 'ol_variant_price_change_down_1',
      detectedAt: new Date('2026-09-10T12:00:00.000Z'),
      sourceOldAmount: 100,
      sourceNewAmount: 80,
      computedOldAmount: 100,
      computedNewAmount: 80, // -20% — down
    });

    // A LIMITED page filtered to 'up' must return BOTH 'up' rows despite a
    // page size of 1 — i.e. `offset` walks the FILTERED set, not the whole
    // unfiltered one. Before the fix this queried the 3 newest rows first
    // (LIMIT 1 OFFSET 0 over the unfiltered set), which is the 'down' row —
    // an application-code post-filter would have returned ZERO 'up' rows on
    // this exact page.
    const upPage1 = await repository.findOpenForConnection(DEST_CONNECTION_ID, {
      direction: 'up',
      limit: 1,
      offset: 0,
    });
    expect(upPage1).toHaveLength(1);
    const upPage2 = await repository.findOpenForConnection(DEST_CONNECTION_ID, {
      direction: 'up',
      limit: 1,
      offset: 1,
    });
    expect(upPage2).toHaveLength(1);
    expect(upPage2[0].id).not.toBe(upPage1[0].id);
    const upPage3 = await repository.findOpenForConnection(DEST_CONNECTION_ID, {
      direction: 'up',
      limit: 1,
      offset: 2,
    });
    expect(upPage3).toHaveLength(0); // exactly 2 'up' rows exist

    // The total must match the page's real filtered population, not be
    // capped at the page's own `limit` (the exact defect this fix closes).
    expect(
      await repository.countOpen({ destinationConnectionId: DEST_CONNECTION_ID, direction: 'up' })
    ).toBe(2);
    expect(
      await repository.countOpen({
        destinationConnectionId: DEST_CONNECTION_ID,
        direction: 'down',
      })
    ).toBe(1);

    // magnitudeLargeOnly: the +30% AND -20% rows are both `|deltaPct| >= 10`.
    const steep = await repository.findOpenForConnection(DEST_CONNECTION_ID, {
      magnitudeLargeOnly: true,
    });
    expect(steep).toHaveLength(2);
    expect(
      await repository.countOpen({
        destinationConnectionId: DEST_CONNECTION_ID,
        magnitudeLargeOnly: true,
      })
    ).toBe(2);

    // Combined: 'up' AND steep — only the +30% row.
    expect(
      await repository.findOpenForConnection(DEST_CONNECTION_ID, {
        direction: 'up',
        magnitudeLargeOnly: true,
      })
    ).toHaveLength(1);
  });

  it('claimForResolution()/releaseClaim() serialise concurrent accept/edit/bulk-item calls (#3162 re-review, IMPORTANT)', async () => {
    const { episode } = await repository.upsertOpen({
      ...baseInput,
      sourceOldAmount: 350,
      sourceNewAmount: 327,
      computedOldAmount: 427,
      computedNewAmount: 399,
    });

    const firstClaimAt = new Date();
    expect(await repository.claimForResolution(episode.id, firstClaimAt)).toBe('claimed');

    // A second caller sees 'in-flight', never silently re-claiming.
    expect(await repository.claimForResolution(episode.id, new Date())).toBe('in-flight');

    // Releasing frees it for a fresh claim.
    await repository.releaseClaim(episode.id);
    const secondClaimAt = new Date();
    expect(await repository.claimForResolution(episode.id, secondClaimAt)).toBe('claimed');

    // Resolving makes the claim moot — a claim attempt against a resolved
    // episode reports 'resolved', never 'claimed' or 'in-flight'.
    await repository.resolve(episode.id, 'accepted', 'user-1', null, new Date());
    expect(await repository.claimForResolution(episode.id, new Date())).toBe('resolved');

    // An unknown id is reported distinctly.
    expect(await repository.claimForResolution('no-such-id', new Date())).toBe('not-found');

    // releaseClaim is idempotent and never throws on an unclaimed/resolved row.
    await expect(repository.releaseClaim(episode.id)).resolves.toBeUndefined();
    await expect(repository.releaseClaim('no-such-id')).resolves.toBeUndefined();
  });
});
