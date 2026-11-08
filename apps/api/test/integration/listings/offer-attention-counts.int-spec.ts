/**
 * Offer Attention Counts Integration Test (#4045)
 *
 * The listings page's "Needs a look" numbers must equal the rows their filters
 * return: `attentionCounts.sellingDeletedProduct` against
 * `GET /listings?staleSignal=selling`, and `attentionCounts.shopBlocked` (and
 * each connection's share) against `GET /listings?shopBlocked=true`. Both
 * sides are built from the same SQL predicates, which only a real Postgres can
 * prove: the jsonb account-scope probe and the stale/stock join do not exist at
 * the mocked repository seam.
 *
 * Also asserted: a number stays readable while its own filter is applied, a
 * malformed problems value does not break the read, and the per-connection
 * problems are distinct and carry the platform code.
 *
 * @module apps/api/test/integration/listings
 */
import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
  type IntegrationTestHarness,
} from '../setup';
import { createTestConnection } from '../helpers/test-connection.helper';
import { loginAsAdmin } from '../helpers/test-auth.helper';

interface AttentionCounts {
  sellingDeletedProduct: number;
  shopBlocked: number;
  shopBlockedByConnection: Array<{
    connectionId: string;
    count: number;
    problems: Array<{ code?: string; message: string }>;
  }>;
}

interface ListingsPageBody {
  items: Array<{ externalId: string }>;
  total: number;
  attentionCounts?: AttentionCounts;
}

const SYNCED_AT = '2026-08-01T10:00:00.000Z';
const KYC = { code: 'shopKyc', message: 'Verify the shop before it can sell.', scope: 'account' };
const PAUSED = { message: 'The shop is paused.', scope: 'account' };
const OFFER_ONLY = { code: 'missingPhoto', message: 'Add a photo.', scope: 'offer' };

describe('Offer Attention Counts API Integration (#4045)', () => {
  let harness: IntegrationTestHarness;
  let token: string;
  let connectionA: string;
  let connectionB: string;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  async function seedOffer(options: {
    externalOfferId: string;
    connection: string;
    stale?: boolean;
    availableQuantity?: number | null;
    statusDetails?: unknown;
  }): Promise<void> {
    const dataSource = harness.getDataSource();
    const variantId = `ol_variant_${options.externalOfferId}`;
    const productId = `ol_product_${options.externalOfferId}`;

    await dataSource.query(
      `INSERT INTO products (id, name, "createdAt", "updatedAt") VALUES ($1, $2, now(), now())`,
      [productId, `Product ${options.externalOfferId}`]
    );
    await dataSource.query(
      `INSERT INTO product_variants (id, "productId", attributes, "isStale", "createdAt", "updatedAt")
       VALUES ($1, $2, '{}'::jsonb, $3, now(), now())`,
      [variantId, productId, options.stale ?? false]
    );
    await dataSource.query(
      `INSERT INTO identifier_mappings
         ("entityType", "internalId", "externalId", "platformType", "connectionId")
       VALUES ('Offer', $1, $2, 'allegro', $3)`,
      [variantId, options.externalOfferId, options.connection]
    );
    await dataSource.query(
      `INSERT INTO offer_status_snapshots
         ("connectionId", "externalOfferId", "internalVariantId", "publicationStatus",
          "statusDetails", "lastStatusSyncedAt")
       VALUES ($1, $2, $3, 'active', $4, $5)`,
      [
        options.connection,
        options.externalOfferId,
        variantId,
        options.statusDetails === undefined ? null : JSON.stringify(options.statusDetails),
        SYNCED_AT,
      ]
    );
    if (options.availableQuantity !== undefined) {
      await dataSource.query(
        `INSERT INTO offer_commercial_snapshots
           ("connectionId", "externalOfferId", "internalVariantId", "availableQuantity", "lastCommercialSyncedAt")
         VALUES ($1, $2, $3, $4, $5)`,
        [options.connection, options.externalOfferId, variantId, options.availableQuantity, SYNCED_AT]
      );
    }
  }

  async function list(query: string): Promise<ListingsPageBody> {
    const response = await harness
      .getHttp()
      .get(`/v1/listings?${query}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return response.body as ListingsPageBody;
  }

  beforeEach(async () => {
    token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
    connectionA = (
      await createTestConnection(harness.getDataSource(), {
        platformType: 'allegro',
        name: 'Shop A',
        adapterKey: 'allegro.publicapi.v1',
      })
    ).id;
    connectionB = (
      await createTestConnection(harness.getDataSource(), {
        platformType: 'allegro',
        name: 'Shop B',
        adapterKey: 'allegro.publicapi.v1',
      })
    ).id;

    // Selling a deleted product: stale variant, stock still on the channel.
    await seedOffer({ externalOfferId: 'stale-selling-1', connection: connectionA, stale: true, availableQuantity: 3 });
    await seedOffer({ externalOfferId: 'stale-selling-2', connection: connectionB, stale: true, availableQuantity: 1 });
    // Stale but paused (0) or unknown (no commercial row): not selling.
    await seedOffer({ externalOfferId: 'stale-paused', connection: connectionA, stale: true, availableQuantity: 0 });
    await seedOffer({ externalOfferId: 'stale-unknown', connection: connectionA, stale: true });
    // Live and selling, product not deleted.
    await seedOffer({ externalOfferId: 'healthy', connection: connectionA, availableQuantity: 5 });

    // Shop-blocked: account-scoped problems, the same code on three listings.
    await seedOffer({ externalOfferId: 'kyc-1', connection: connectionA, statusDetails: { validationProblems: [KYC] } });
    await seedOffer({ externalOfferId: 'kyc-2', connection: connectionA, statusDetails: { validationProblems: [KYC, OFFER_ONLY] } });
    await seedOffer({ externalOfferId: 'kyc-3', connection: connectionA, statusDetails: { validationProblems: [KYC, PAUSED] } });
    await seedOffer({ externalOfferId: 'paused-b', connection: connectionB, statusDetails: { validationProblems: [PAUSED] } });
    // Offer-scoped only, and a malformed value: neither counts, neither breaks.
    await seedOffer({ externalOfferId: 'offer-only', connection: connectionA, statusDetails: { validationProblems: [OFFER_ONLY] } });
    await seedOffer({ externalOfferId: 'malformed', connection: connectionA, statusDetails: { validationProblems: 'nope' } });
  });

  it('should count exactly the rows staleSignal=selling returns', async () => {
    const counts = (await list('includeLifecycleCounts=true')).attentionCounts;
    const page = await list('staleSignal=selling&limit=100');

    expect(counts?.sellingDeletedProduct).toBe(2);
    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.externalId).sort()).toEqual(['stale-selling-1', 'stale-selling-2']);
  });

  it('should count exactly the rows shopBlocked=true returns, per connection too', async () => {
    const counts = (await list('includeLifecycleCounts=true')).attentionCounts;
    const page = await list('shopBlocked=true&limit=100');

    expect(counts?.shopBlocked).toBe(4);
    expect(page.total).toBe(4);
    expect(page.items.map((i) => i.externalId).sort()).toEqual(['kyc-1', 'kyc-2', 'kyc-3', 'paused-b']);

    for (const connection of counts?.shopBlockedByConnection ?? []) {
      const connectionPage = await list(`shopBlocked=true&connectionId=${connection.connectionId}&limit=100`);
      expect(connectionPage.total).toBe(connection.count);
    }
  });

  it('should list distinct account problems per connection, most widespread first, with their code', async () => {
    const counts = (await list('includeLifecycleCounts=true')).attentionCounts;
    const a = counts?.shopBlockedByConnection.find((c) => c.connectionId === connectionA);
    const b = counts?.shopBlockedByConnection.find((c) => c.connectionId === connectionB);

    expect(a?.count).toBe(3);
    expect(a?.problems).toEqual([
      { code: 'shopKyc', message: KYC.message },
      { message: PAUSED.message },
    ]);
    expect(b).toEqual({ connectionId: connectionB, count: 1, problems: [{ message: PAUSED.message }] });
  });

  it('should keep each number readable while its own filter is applied', async () => {
    const blocked = (await list('shopBlocked=true&includeLifecycleCounts=true')).attentionCounts;
    const selling = (await list('staleSignal=selling&includeLifecycleCounts=true')).attentionCounts;

    expect(blocked?.shopBlocked).toBe(4);
    expect(selling?.sellingDeletedProduct).toBe(2);
  });

  it('should narrow the counts by the other membership filters', async () => {
    const counts = (await list(`connectionId=${connectionB}&includeLifecycleCounts=true`)).attentionCounts;

    expect(counts?.sellingDeletedProduct).toBe(1);
    expect(counts?.shopBlocked).toBe(1);
  });
});
