/**
 * Offer Lifecycle Counts Integration Test (#2026)
 *
 * The headline acceptance criterion of #2026 - "the per-bucket counts sum to
 * the filtered total, and each bucket's count equals the size of that tab's own
 * page" - is a DATABASE property. It depends on the grouped aggregate and the
 * `getCount()` on the list path describing the same row set with the same
 * cardinality, which no unit test can reach: at the repository seam the query
 * builder is mocked, so any sum assertion there only restates its own fixture.
 *
 * So this spec seeds mappings across all five buckets into a real Postgres
 * (Testcontainers) and drives `GET /v1/listings` - the surface FE-C (#2029)
 * actually consumes, so the controller's concurrent list+counts pair and the
 * response DTO are covered alongside the SQL. It asserts:
 *  - `sum(lifecycleCounts) === total` on an unfiltered request;
 *  - per bucket, `lifecycleCounts[bucket] === total` when that tab is selected,
 *    and equals the number of rows the tab's page actually returns;
 *  - every returned row's own `channelStatus.lifecycle` is the bucket asked for
 *    (the generated WHERE predicate and the per-row derivation are one rule);
 *  - selecting a tab leaves every OTHER tab's count untouched;
 *  - a `search` narrowing applies to both reads, so the sum still holds;
 *  - a second connection's offers never reach either read.
 *
 * Note on the Unsynced fixture: `offer_status_snapshots."lastStatusSyncedAt"` is
 * `NOT NULL` in the schema, so the "snapshot row present but never synced" shape
 * the presence predicate also guards against is unreachable through Postgres and
 * cannot be seeded here. It is pinned at the unit level instead, in
 * `offer-mapping.repository.spec.ts`'s snapshot-presence agreement block. The
 * reachable shape - no snapshot row at all - is seeded twice below.
 *
 * @module apps/api/test/integration/listings
 */
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from '../setup';
import { createTestConnection } from '../helpers/test-connection.helper';
import { loginAsAdmin } from '../helpers/test-auth.helper';

/**
 * Spelled out rather than imported from the core barrel: this spec is asserting
 * the WIRE contract, so a renamed or dropped bucket must fail here instead of
 * quietly following the source it is meant to pin.
 */
const BUCKETS = ['Active', 'Invalid', 'Draft', 'Ended', 'Unsynced'] as const;
type Bucket = (typeof BUCKETS)[number];

type LifecycleCounts = Record<Bucket, number>;

interface ListingsPageBody {
  items: Array<{ externalId: string; channelStatus: { lifecycle: Bucket } }>;
  total: number;
  lifecycleCounts: LifecycleCounts;
}

const SYNCED_AT = '2026-08-01T10:00:00.000Z';

/**
 * 14 mappings on the connection under test: Active 4 (active x2 + activating +
 * inactivating), Invalid 2, Draft 3 (one with no statusDetails, one with an
 * empty message array, one with neither), Ended 2, Unsynced 3 (2 with no
 * snapshot row at all, 1 with a snapshot whose `publicationStatus` is
 * out-of-union - see thread 1 of the #2032 review).
 */
const EXPECTED: LifecycleCounts = {
  Active: 4,
  Invalid: 2,
  Draft: 3,
  Ended: 2,
  Unsynced: 3,
};
const TOTAL = 14;

describe('Offer Lifecycle Counts API Integration (#2026)', () => {
  let harness: IntegrationTestHarness;
  let token: string;
  let connectionId: string;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  /**
   * Seed one Offer mapping and, when a status is given, the snapshot row it
   * joins to. Omitting the status is the Unsynced case: the mapping exists and
   * the status-snapshot LEFT join finds nothing.
   */
  async function seedOffer(options: {
    externalOfferId: string;
    connection?: string;
    publicationStatus?: 'active' | 'activating' | 'inactivating' | 'inactive' | 'ended';
    validationMessages?: string[];
  }): Promise<void> {
    const target = options.connection ?? connectionId;
    const dataSource = harness.getDataSource();

    await dataSource.query(
      `INSERT INTO identifier_mappings
         ("entityType", "internalId", "externalId", "platformType", "connectionId")
       VALUES ('Offer', $1, $2, 'allegro', $3)`,
      [`ol_variant_${options.externalOfferId}`, options.externalOfferId, target]
    );

    if (options.publicationStatus === undefined) return;

    await dataSource.query(
      `INSERT INTO offer_status_snapshots
         ("connectionId", "externalOfferId", "internalVariantId", "publicationStatus",
          "statusDetails", "lastStatusSyncedAt")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        target,
        options.externalOfferId,
        `ol_variant_${options.externalOfferId}`,
        options.publicationStatus,
        options.validationMessages
          ? JSON.stringify({ validationMessages: options.validationMessages })
          : null,
        SYNCED_AT,
      ]
    );
  }

  async function listListings(query: string): Promise<ListingsPageBody> {
    const response = await harness
      .getHttp()
      .get(`/v1/listings?${query}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return response.body as ListingsPageBody;
  }

  function sum(counts: LifecycleCounts): number {
    return BUCKETS.reduce((total, bucket) => total + counts[bucket], 0);
  }

  beforeEach(async () => {
    token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());

    const connection = await createTestConnection(harness.getDataSource(), {
      platformType: 'allegro',
      name: 'Lifecycle counts connection',
      adapterKey: 'allegro.publicapi.v1',
    });
    connectionId = connection.id;
    const other = await createTestConnection(harness.getDataSource(), {
      platformType: 'allegro',
      name: 'Other connection',
      adapterKey: 'allegro.publicapi.v1',
    });

    await seedOffer({ externalOfferId: 'terra-active-1', publicationStatus: 'active' });
    await seedOffer({ externalOfferId: 'terra-active-2', publicationStatus: 'active' });
    await seedOffer({ externalOfferId: 'activating-1', publicationStatus: 'activating' });
    await seedOffer({ externalOfferId: 'inactivating-1', publicationStatus: 'inactivating' });

    // `inactive` splits on validator-message presence - the only signal
    // separating Invalid from Draft.
    await seedOffer({
      externalOfferId: 'terra-rejected-1',
      publicationStatus: 'inactive',
      validationMessages: ['Brak parametru: Marka'],
    });
    await seedOffer({
      externalOfferId: 'rejected-2',
      publicationStatus: 'inactive',
      validationMessages: ['Brak parametru: Model', 'Zdjecie zbyt male'],
    });
    await seedOffer({ externalOfferId: 'draft-1', publicationStatus: 'inactive' });
    await seedOffer({ externalOfferId: 'draft-2', publicationStatus: 'inactive' });
    // An empty message array must read as Draft, not Invalid.
    await seedOffer({
      externalOfferId: 'draft-3',
      publicationStatus: 'inactive',
      validationMessages: [],
    });

    await seedOffer({ externalOfferId: 'ended-1', publicationStatus: 'ended' });
    await seedOffer({ externalOfferId: 'ended-2', publicationStatus: 'ended' });

    // Unsynced: the mapping exists, no status has ever been read for it.
    await seedOffer({ externalOfferId: 'terra-unsynced-1' });
    await seedOffer({ externalOfferId: 'unsynced-2' });

    // Unsynced via an out-of-union `publicationStatus` (e.g. a renamed member
    // mid-migration, ADR-009): the snapshot row EXISTS and is fully synced, so
    // `HAS_STATUS_SNAPSHOT_SQL` alone would wrongly exclude it from Unsynced
    // while it also fails every recognised-status predicate - landing on no
    // tab at all. `seedOffer` only accepts union values, so this row is
    // inserted directly with a status the union does not contain.
    await seedOffer({ externalOfferId: 'unrecognised-status-1' });
    // `seedOffer` only accepts union values for `publicationStatus`, so the
    // out-of-union snapshot row is inserted directly here.
    await harness.getDataSource().query(
      `INSERT INTO offer_status_snapshots
         ("connectionId", "externalOfferId", "internalVariantId", "publicationStatus",
          "statusDetails", "lastStatusSyncedAt")
       VALUES ($1, $2, $3, 'archived', NULL, $4)`,
      [connectionId, 'unrecognised-status-1', 'ol_variant_unrecognised-status-1', SYNCED_AT]
    );

    // Must never be counted for `connectionId`.
    await seedOffer({
      externalOfferId: 'other-conn-active',
      connection: other.id,
      publicationStatus: 'active',
    });
  });

  it('reports the expected per-bucket counts, scoped to the connection', async () => {
    const body = await listListings(`connectionId=${connectionId}&limit=100`);

    expect(body.lifecycleCounts).toEqual(EXPECTED);
  });

  it('sums the buckets to the unfiltered total', async () => {
    const body = await listListings(`connectionId=${connectionId}&limit=100`);

    // The acceptance criterion: no row belongs to zero or to two buckets.
    expect(sum(body.lifecycleCounts)).toBe(body.total);
    expect(body.total).toBe(TOTAL);
    expect(body.items).toHaveLength(TOTAL);
  });

  it.each(BUCKETS)('agrees with the %s tab page on both its size and its rows', async (bucket) => {
    const body = await listListings(
      `connectionId=${connectionId}&lifecycle=${bucket}&limit=100`
    );

    // The count labels the tab; `total` sizes its paging. They must agree, or
    // the tab reads "12" and pages through 9.
    expect(body.total).toBe(EXPECTED[bucket]);
    expect(body.lifecycleCounts[bucket]).toBe(EXPECTED[bucket]);
    expect(body.items).toHaveLength(EXPECTED[bucket]);
    // And the rows the tab actually shows classify themselves into it.
    for (const item of body.items) {
      expect(item.channelStatus.lifecycle).toBe(bucket);
    }
  });

  it('leaves every other tab live while one tab is selected', async () => {
    const body = await listListings(`connectionId=${connectionId}&lifecycle=Ended&limit=100`);

    // `total` follows the selection so paging inside the tab is correct, but the
    // counts deliberately do not - otherwise clicking a tab zeroes the bar.
    expect(body.total).toBe(EXPECTED.Ended);
    expect(body.lifecycleCounts).toEqual(EXPECTED);
    expect(sum(body.lifecycleCounts)).toBe(TOTAL);
  });

  it('keeps the partition intact under a search narrowing', async () => {
    // Four seeded offers carry `terra` in their external id: 2 Active,
    // 1 Invalid, 1 Unsynced. The counts must narrow with the list, or the tab
    // bar would describe the whole catalog while the page shows the search.
    const body = await listListings(`connectionId=${connectionId}&search=terra&limit=100`);

    expect(body.lifecycleCounts).toEqual({
      Active: 2,
      Invalid: 1,
      Draft: 0,
      Ended: 0,
      Unsynced: 1,
    });
    expect(sum(body.lifecycleCounts)).toBe(body.total);
    expect(body.total).toBe(4);
  });

  it('reports every bucket zeroed rather than absent when a filter matches nothing', async () => {
    const body = await listListings(
      `connectionId=${connectionId}&search=no-such-offer-anywhere&limit=100`
    );

    // A tab with no rows must render "0", never vanish from the bar.
    expect(body.lifecycleCounts).toEqual({
      Active: 0,
      Invalid: 0,
      Draft: 0,
      Ended: 0,
      Unsynced: 0,
    });
    expect(Object.keys(body.lifecycleCounts).sort()).toEqual([...BUCKETS].sort());
    expect(body.total).toBe(0);
  });

  it('rejects an unknown lifecycle bucket rather than silently ignoring it', async () => {
    // Silently returning the whole catalog would read as "nothing has ended".
    await harness
      .getHttp()
      .get(`/v1/listings?connectionId=${connectionId}&lifecycle=Archived`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });
});
