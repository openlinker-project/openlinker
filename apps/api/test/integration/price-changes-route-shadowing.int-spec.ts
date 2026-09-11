/**
 * Price Changes Route-Shadowing API Integration Test (#3162 review — BLOCKING)
 *
 * Nest matches routes in controller-REGISTRATION order with no
 * static-before-dynamic sorting. `ListingsController` (`@Controller('listings')`)
 * declares `@Get(':id')` guarded by `ParseUUIDPipe`; if it is registered
 * BEFORE `PriceChangesController` (`@Controller('listings/price-changes')`),
 * a request to `GET /listings/price-changes` matches `GET /listings/:id`
 * with `id='price-changes'` first, and the UUID pipe rejects it with 400 —
 * the review-queue tab is dead on arrival in production.
 *
 * `apps/api/test/integration/listings-invalid-path-id.int-spec.ts` proves
 * the pipe fires correctly for a genuinely malformed id; this spec proves
 * the OTHER direction — that a real, static sibling route is not shadowed
 * by it. Only a real HTTP round trip through the Nest router (not a
 * controller unit test, which bypasses route matching entirely) can catch
 * a regression here — see `apps/api/src/listings/listings.module.ts`'s
 * `controllers` array ordering.
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

describe('Price Changes Route-Shadowing API Integration', () => {
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

  describe('GET /listings/price-changes', () => {
    it('resolves to the price-changes review queue, never to GET /listings/:id', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const response = await http
        .get('/v1/listings/price-changes')
        .set('Authorization', `Bearer ${token}`);

      // A 400 here means the request was captured by `ListingsController`'s
      // `@Get(':id')` + `ParseUUIDPipe('price-changes')` — the exact
      // regression this spec exists to catch.
      expect(response.status).not.toBe(400);
      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          items: expect.any(Array),
          hiddenStaleCount: expect.any(Number),
          total: expect.any(Number),
        })
      );
    });
  });

  describe('GET /listings/price-changes/auto-applied', () => {
    it('resolves to the auto-applied log, never to GET /listings/:id/offer or similar', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const response = await http
        .get('/v1/listings/price-changes/auto-applied')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });
});
