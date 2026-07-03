/**
 * Listings Invalid Path-Id API Integration Test
 *
 * Proves `ParseUUIDPipe` fires on the three `listings` routes that forward a
 * raw path param straight into a UUID-typed DB lookup (#1213). A malformed
 * id must return 400 (rejected before touching the DB), while a well-formed
 * but absent UUID must keep returning the existing 404 behavior unchanged.
 *
 * Controller unit tests call the controller methods directly and bypass
 * Nest's parameter-decorator pipe pipeline, so this is the only place that
 * genuinely exercises `ParseUUIDPipe`.
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

const VALID_ABSENT_UUID = '99999999-9999-4999-8999-999999999999';
const VALID_CONNECTION_UUID = '11111111-1111-4111-8111-111111111111';
const NON_UUID_ID = 'ol_variant_2dab6f6bd3a542b3b6e86a1bc6696150';

describe('Listings Invalid Path-Id API Integration', () => {
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

  describe('GET /listings/:id', () => {
    it('returns 400 for a non-UUID id', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .get(`/v1/listings/${NON_UUID_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('returns 404 for a well-formed but absent UUID', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .get(`/v1/listings/${VALID_ABSENT_UUID}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('GET /listings/:id/offer', () => {
    it('returns 400 for a non-UUID id', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .get(`/v1/listings/${NON_UUID_ID}/offer`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  describe('GET /listings/connections/:connectionId/offers/creation/:offerCreationRecordId', () => {
    it('returns 400 for a non-UUID offerCreationRecordId', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .get(`/v1/listings/connections/${VALID_CONNECTION_UUID}/offers/creation/${NON_UUID_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('returns 404 for a non-UUID connectionId (unguarded, falls through to not-found)', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .get(`/v1/listings/connections/${NON_UUID_ID}/offers/creation/${VALID_ABSENT_UUID}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });
});
