/**
 * Price-override bound — HTTP contract (#3222, #3236 review)
 *
 * The refusal is raised in `PriceChangesService.edit` and mapped to 422 by
 * `PriceChangesController.wrapDomainErrors`. That `instanceof` arm was the one
 * link with no coverage: the service spec asserts the exception, and the
 * repository int-spec never exercises `edit`.
 *
 * The repo has recorded exactly this failure — "#2332 and #2333 were built
 * concurrently and each defined a rival `ReturnNotFoundError` … two
 * same-named classes fail `instanceof` against each other silently … the HTTP
 * filter would answer 500 for a refusal the service raised deliberately"
 * (`architecture-overview.md` § 22). On a stack this deep, with several open
 * PRs touching these files, a real round trip through the router is the only
 * thing that proves the operator gets 422 and not 500.
 *
 * @module apps/api/test/integration
 */
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';

const DEST_CONNECTION_ID = '44444444-4444-4444-8444-444444444444';
const SRC_CONNECTION_ID = '55555555-5555-4555-8555-555555555555';

describe('Price-override bound over HTTP (#3222)', () => {
  let harness: IntegrationTestHarness;

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
   * Seeded with raw SQL rather than through `PriceChangeEpisodeRepositoryPort`:
   * `scripts/check-cross-context-imports.mjs` denies a `*RepositoryPort` import
   * from a core barrel, and this spec's subject is the HTTP contract, not the
   * repository's API — so it should not couple to it either way.
   */
  async function openEpisode(): Promise<string> {
    const rows: Array<{ id: string }> = await harness.getDataSource().query(
      `INSERT INTO price_change_episodes
         ("productVariantId", "destinationConnectionId", "sourceConnectionId", "sourceCurrency",
          "sourceOldAmount", "sourceNewAmount", "computedOldAmount", "computedNewAmount", "detectedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        'ol_variant_override_bound_1',
        DEST_CONNECTION_ID,
        SRC_CONNECTION_ID,
        'PLN',
        350,
        327,
        427,
        399,
        new Date('2026-09-14T10:00:00.000Z'),
      ]
    );
    return rows[0].id;
  }

  it('answers 422 — not 500 — for a disproportionate override, and carries the bound as fields', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());
    const episodeId = await openEpisode();

    // 39900 against a computed 399 — the 100x typo the bound exists to catch.
    const response = await http
      .post(`/v1/listings/price-changes/${episodeId}/edit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ manualPriceOverride: 39_900 });

    expect(response.status).toBe(422);
    // Fields, not prose: a client that parsed the sentence would break on the
    // first reword (#3236 review).
    expect(response.body).toEqual(
      expect.objectContaining({
        outcome: 'too-high',
        attempted: 39_900,
        computedAmount: 399,
        limit: 3990,
      })
    );
  });

  it('leaves the episode OPEN and claimable after the refusal', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());
    const episodeId = await openEpisode();

    await http
      .post(`/v1/listings/price-changes/${episodeId}/edit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ manualPriceOverride: 39_900 });

    // The refusal releases its claim, so a corrected price immediately after
    // must succeed rather than hitting "already claimed by another in-flight
    // request" — otherwise the operator is locked out by their own typo.
    const corrected = await http
      .post(`/v1/listings/price-changes/${episodeId}/edit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ manualPriceOverride: 420 });

    expect(corrected.status).toBe(200);
  });

  it('accepts a large but plausible correction', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());
    const episodeId = await openEpisode();

    const response = await http
      .post(`/v1/listings/price-changes/${episodeId}/edit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ manualPriceOverride: 1197 });

    expect(response.status).toBe(200);
  });
});
