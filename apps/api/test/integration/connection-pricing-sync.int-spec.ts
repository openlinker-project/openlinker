/**
 * Connection Pricing & Sync API Integration Test (#3146, ADR-072; #3163 review)
 *
 * A real HTTP round trip through the Nest router, so status codes and
 * per-route auth (`@Roles`) are exercised for real rather than asserted
 * against a hand-rolled guard mock. Covers the three routes'
 * happy paths plus the two write-path refusals a controller unit test
 * cannot exercise (the `viable destination` capability gate, going through
 * the real `IIntegrationsService`; and the optimistic-concurrency 409,
 * going through the real `ConnectionService.update`).
 *
 * @module apps/api/test/integration
 */
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { loginAsAdmin, loginAsOperator } from './helpers/test-auth.helper';
import { createTestConnection } from './helpers/test-connection.helper';

describe('Connection Pricing & Sync API Integration', () => {
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

  describe('GET /connections/:connectionId/pricing-sync', () => {
    it('reports an unconfigured connection as manual/null rather than a synthesized rule', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const connection = await createTestConnection(dataSource);

      const response = await http
        .get(`/v1/connections/${connection.id}/pricing-sync`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({ default: { mode: 'manual', rule: null }, sources: [] })
      );
    });

    it('404s on a well-formed but non-existent connection id', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const response = await http
        .get('/v1/connections/00000000-0000-0000-0000-000000000000/pricing-sync')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
    });

    it('400s on a malformed (non-UUID) connection id', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const response = await http
        .get('/v1/connections/not-a-uuid/pricing-sync')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
    });
  });

  describe('PATCH /connections/:connectionId/pricing-sync', () => {
    it('saves the default rule + mode and reads it back unchanged', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const connection = await createTestConnection(dataSource);

      const patchResponse = await http
        .patch(`/v1/connections/${connection.id}/pricing-sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          default: { mode: 'automatic', rule: { type: 'markup', percent: 15, rounding: 'none' } },
        });

      expect(patchResponse.status).toBe(200);
      expect(patchResponse.body.default).toEqual({
        mode: 'automatic',
        rule: { type: 'markup', percent: 15, rounding: 'none' },
      });

      const getResponse = await http
        .get(`/v1/connections/${connection.id}/pricing-sync`)
        .set('Authorization', `Bearer ${token}`);
      expect(getResponse.body.default).toEqual({
        mode: 'automatic',
        rule: { type: 'markup', percent: 15, rounding: 'none' },
      });
    });

    it('400s when a sourceOverrides key is not a connection id', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const connection = await createTestConnection(dataSource);

      const response = await http
        .patch(`/v1/connections/${connection.id}/pricing-sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          default: { mode: 'manual', rule: null },
          sourceOverrides: { 'not-a-connection-id': { mode: 'automatic' } },
        });

      expect(response.status).toBe(400);
    });

    it('400s when the connection cannot be a pricing destination (ADR-072 decision 2)', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      // No adapter in the registry supports neither OfferManager nor
      // ProductPublisher for a platformType this connection resolves to
      // truthfully as a source-only capability set; the KSeF invoicing
      // adapter is the tree's own worked example of a non-destination.
      const connection = await createTestConnection(dataSource, {
        platformType: 'ksef',
        adapterKey: 'ksef.publicapi.v2',
      });

      const response = await http
        .patch(`/v1/connections/${connection.id}/pricing-sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({ default: { mode: 'manual', rule: null } });

      expect(response.status).toBe(400);
    });

    it('409s on a stale expectedUpdatedAt', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const connection = await createTestConnection(dataSource);

      const response = await http
        .patch(`/v1/connections/${connection.id}/pricing-sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          default: { mode: 'manual', rule: null },
          expectedUpdatedAt: new Date('2000-01-01T00:00:00.000Z').toISOString(),
        });

      expect(response.status).toBe(409);
    });

    it('refuses a non-admin write with 403', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const connection = await createTestConnection(dataSource);
      const token = await loginAsOperator(http, dataSource);

      const response = await http
        .patch(`/v1/connections/${connection.id}/pricing-sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({ default: { mode: 'manual', rule: null } });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /connections/:connectionId/pricing-sync/as-source', () => {
    it('returns an empty rollup for a connection nobody names as a source', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const connection = await createTestConnection(dataSource);

      const response = await http
        .get(`/v1/connections/${connection.id}/pricing-sync/as-source`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('lists a destination that overrides this connection specifically', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const source = await createTestConnection(dataSource, { name: 'Source Shop' });
      const destination = await createTestConnection(dataSource, {
        name: 'Destination Shop',
        config: {
          pricingRule: {
            default: { type: 'passthrough' },
            sourceOverrides: { [source.id]: { type: 'markup', percent: 10, rounding: 'none' } },
          },
        },
      });

      const response = await http
        .get(`/v1/connections/${source.id}/pricing-sync/as-source`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        expect.objectContaining({ destinationConnectionId: destination.id, ruleOverridden: true }),
      ]);
    });
  });
});
