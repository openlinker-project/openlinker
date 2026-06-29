/**
 * Operator Role Authorization Integration Test
 *
 * Proves that the per-method @Roles('admin', 'operator') guards introduced in
 * #1126 are correctly wired end-to-end:
 *
 *  - Operator JWT → 2xx on operational write endpoints (guard passes; handler
 *    may 400/404 on missing data, but NOT 403)
 *  - Operator JWT → 403 on administrative endpoints (connections write, sync
 *    write, AI settings, prompt templates, webhook-deliveries, cursors, users)
 *  - Operator JWT → Connection.config redacted to {} (same as viewer — operator
 *    is not admin)
 *
 * Pattern mirrors viewer-role-authz.int-spec.ts: RolesGuard fires before the
 * handler, so even invalid bodies or non-existent resource IDs do not produce
 * 403 when the guard passes.
 *
 * @module apps/api/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { IntegrationTestHarness } from './setup';
import { createPrestashopConnectionDto } from './fixtures/connection.fixtures';
import { loginAsAdmin, loginAsOperator } from './helpers/test-auth.helper';

describe('Operator Role Authorization', () => {
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

  async function seeds() {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const adminToken = await loginAsAdmin(http, dataSource, 'admin');
    const operatorToken = await loginAsOperator(http, dataSource, 'operator');
    return { http, dataSource, adminToken, operatorToken };
  }

  // ─── operator writes that should pass the guard (not 403) ───────────────────
  //
  // The guard fires before the handler body. Even with an invalid body or
  // non-existent resource the response is NOT 403 — it will be 400/404/409.

  describe('operational writes — operator NOT blocked (guard passes)', () => {
    it('POST /orders/:id/destinations/:connectionId/retry → 404 (guard passes; order unknown)', async () => {
      const { http, operatorToken } = await seeds();
      await http
        .post('/orders/fake-order-id/destinations/00000000-0000-4000-8000-000000000001/retry')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect((res) => {
          expect(res.status).not.toBe(403);
        });
    });

    it('POST /listings/connections/:connectionId/offers → not 403 (guard passes; handler validates)', async () => {
      const { http, operatorToken } = await seeds();
      const res = await http
        .post('/listings/connections/00000000-0000-4000-8000-000000000001/offers')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({});
      expect(res.status).not.toBe(403);
    });

    it('POST /listings/bulk-create → not 403 (guard passes; handler validates body)', async () => {
      const { http, operatorToken } = await seeds();
      const res = await http
        .post('/listings/bulk-create')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({});
      expect(res.status).not.toBe(403);
    });

    it('POST /listings/bulk-shop-publish → not 403 (guard passes; handler validates body)', async () => {
      const { http, operatorToken } = await seeds();
      const res = await http
        .post('/listings/bulk-shop-publish')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({});
      expect(res.status).not.toBe(403);
    });

    it('GET /listings/connections/:connectionId/seller-policies → not 403 (guard passes; connection unknown)', async () => {
      const { http, operatorToken } = await seeds();
      const res = await http
        .get('/listings/connections/00000000-0000-4000-8000-000000000001/seller-policies')
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(res.status).not.toBe(403);
    });

    it('GET /shipments → 200 (operator has full shipment access)', async () => {
      const { http, operatorToken } = await seeds();
      await http
        .get('/shipments')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
    });

    it('GET /pickup-points → 200 (operator has pickup-point access)', async () => {
      const { http, operatorToken } = await seeds();
      await http
        .get('/pickup-points')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
    });
  });

  // ─── administrative writes — operator gets 403 ──────────────────────────────

  describe('administrative writes — operator gets 403', () => {
    it('POST /connections → 403', async () => {
      const { http, operatorToken } = await seeds();
      const dto = createPrestashopConnectionDto();
      await http
        .post('/connections')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send(dto)
        .expect(403);
    });

    it('PATCH /connections/:id → 403', async () => {
      const { http, adminToken, operatorToken } = await seeds();
      const dto = createPrestashopConnectionDto();
      const { body: conn } = await http
        .post('/connections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(dto)
        .expect(201);
      await http
        .patch(`/connections/${conn.id as string}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: 'should-be-blocked' })
        .expect(403);
    });

    it('PUT /connections/:id/credentials → 403', async () => {
      const { http, adminToken, operatorToken } = await seeds();
      const dto = createPrestashopConnectionDto();
      const { body: conn } = await http
        .post('/connections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(dto)
        .expect(201);
      await http
        .put(`/connections/${conn.id as string}/credentials`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ credentials: {} })
        .expect(403);
    });

    it('POST /connections/:id/webhooks/install → 403', async () => {
      const { http, adminToken, operatorToken } = await seeds();
      const dto = createPrestashopConnectionDto();
      const { body: conn } = await http
        .post('/connections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(dto)
        .expect(201);
      await http
        .post(`/connections/${conn.id as string}/webhooks/install`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
    });

    it('POST /sync/jobs → 403', async () => {
      const { http, operatorToken } = await seeds();
      await http
        .post('/sync/jobs')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ jobType: 'marketplace.orders.poll', connectionId: '00000000-0000-4000-8000-000000000001' })
        .expect(403);
    });

    it('POST /sync/jobs/retry-grouped → 403', async () => {
      const { http, operatorToken } = await seeds();
      await http
        .post('/sync/jobs/retry-grouped')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ connectionId: '00000000-0000-4000-8000-000000000001', jobType: 'marketplace.orders.poll' })
        .expect(403);
    });

    it('GET /connections/:id/diagnostics → 403 (admin-only GET)', async () => {
      const { http, adminToken, operatorToken } = await seeds();
      const dto = createPrestashopConnectionDto();
      const { body: conn } = await http
        .post('/connections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(dto)
        .expect(201);
      await http
        .get(`/connections/${conn.id as string}/diagnostics`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
    });

    it('GET /prompt-templates → 403 (entire controller admin-only)', async () => {
      const { http, operatorToken } = await seeds();
      await http
        .get('/prompt-templates')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
    });

    it('PUT /ai-provider-settings/active → 403 (entire controller admin-only)', async () => {
      const { http, operatorToken } = await seeds();
      await http
        .put('/ai-provider-settings/active')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ provider: 'anthropic' })
        .expect(403);
    });

    it('GET /webhook-deliveries → 403 (entire controller admin-only)', async () => {
      const { http, operatorToken } = await seeds();
      await http
        .get('/webhook-deliveries')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
    });

    it('GET /cursors → 403 (entire controller admin-only)', async () => {
      const { http, operatorToken } = await seeds();
      await http
        .get('/cursors')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
    });

    it('GET /users → 403 (entire controller admin-only)', async () => {
      const { http, operatorToken } = await seeds();
      await http
        .get('/users')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
    });
  });

  // ─── config redaction ───────────────────────────────────────────────────────
  //
  // Operator is not admin, so Connection.config must be redacted to {}.

  describe('config redaction — operator behaves like viewer (non-admin)', () => {
    it('GET /connections/:id returns {} config for operator', async () => {
      const { http, adminToken, operatorToken } = await seeds();
      const dto = createPrestashopConnectionDto({
        config: { baseUrl: 'https://shop.example.com', shopId: 1, langId: 1 },
      });

      const { body: conn } = await http
        .post('/connections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(dto)
        .expect(201);

      const operatorGet = await http
        .get(`/connections/${conn.id as string}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      expect(operatorGet.body.config).toEqual({});
      expect(operatorGet.body.id).toBe(conn.id as string);
      expect(operatorGet.body.platformType).toBe('prestashop');
    });

    it('GET /connections list returns {} config for every connection when called by operator', async () => {
      const { http, adminToken, operatorToken } = await seeds();

      const dto1 = createPrestashopConnectionDto({ name: 'Store A' });
      await http.post('/connections').set('Authorization', `Bearer ${adminToken}`).send(dto1).expect(201);

      const { body: list } = await http
        .get('/connections')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      expect(Array.isArray(list)).toBe(true);
      (list as { config: unknown }[]).forEach((connection) => {
        expect(connection.config).toEqual({});
      });
    });
  });
});
