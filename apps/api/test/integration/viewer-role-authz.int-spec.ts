/**
 * Viewer Role Authorization Integration Test
 *
 * Proves that the per-method @Roles('admin') guards introduced in #1124, and
 * extended to Invoicing/Customers/Shipments/Pickup-Points in #1357, are
 * correctly wired end-to-end:
 *
 *  - Viewer JWT → 200 on representative read endpoints across all covered controllers
 *  - Viewer JWT → 403 on representative write endpoints (guard fires before handler)
 *  - Viewer JWT → Connection.config redacted to {} in both list and get responses
 *  - Admin JWT  → Connection.config returned in full
 *
 * This test is the regression guard for the posture shift from deny-by-default
 * (class-level @Roles) to opt-in-per-endpoint (#1124 IMPORTANT #2). A future
 * PR that adds a write endpoint and forgets the guard will surface as a 200
 * instead of the expected 403 here.
 *
 * @module apps/api/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { IntegrationTestHarness } from './setup';
import { createPrestashopConnectionDto } from './fixtures/connection.fixtures';
import { loginAsAdmin, loginAsViewer } from './helpers/test-auth.helper';

describe('Viewer Role Authorization', () => {
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
   * Seed both an admin and a viewer user and return the HTTP agent +
   * tokens. Called inside each `it` so the users table is clean.
   */
  async function seeds() {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const adminToken = await loginAsAdmin(http, dataSource, 'admin');
    const viewerToken = await loginAsViewer(http, dataSource, 'viewer');
    return { http, dataSource, adminToken, viewerToken };
  }

  // ─── reads: viewer gets 200 ─────────────────────────────────────────────────

  describe('reads — viewer gets 200', () => {
    it('GET /connections', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .get('/v1/connections')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
    });

    it('GET /connections/:id/diagnostics (#1645 - read stays viewer-accessible)', async () => {
      const { http, adminToken, viewerToken } = await seeds();
      const dto = createPrestashopConnectionDto();
      const { body: conn } = await http
        .post('/v1/connections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(dto)
        .expect(201);
      await http
        .get(`/v1/connections/${conn.id as string}/diagnostics`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
    });

    it('GET /orders', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .get('/v1/orders')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
    });

    it('GET /sync/jobs', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .get('/v1/sync/jobs')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
    });

    it('GET /products', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .get('/v1/products')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
    });

    it('GET /inventory', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .get('/v1/inventory')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
    });

    it('GET /listings', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .get('/v1/listings')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
    });

    it('GET /customers', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .get('/v1/customers')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
    });

    it('GET /shipments', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .get('/v1/shipments')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
    });

    it('GET /pickup-points', async () => {
      const { http, viewerToken } = await seeds();
      const res = await http
        .get('/v1/pickup-points')
        .set('Authorization', `Bearer ${viewerToken}`);
      // No `connectionId`/query params seeded — assert the guard passes
      // (not 403), matching the operator-role-authz precedent for this same
      // endpoint (operator-role-authz.int-spec.ts).
      expect(res.status).not.toBe(403);
    });

    it('GET /invoices', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .get('/v1/invoices')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
    });

    it('GET /webhook-deliveries', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .get('/v1/webhook-deliveries')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
    });

    it('GET /cursors', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .get('/v1/cursors')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
    });
  });

  // ─── #1608: bulk-create wizard read-lookups — viewer NOT blocked ───────────
  //
  // A demo-mode viewer must be able to walk the bulk-create offer wizard to
  // step 4 (Confirm): every read-only lookup it drives must pass the guard.
  // The connection id is fake so the handler itself 404s/409s/422s past the
  // guard — the assertion is only that RolesGuard does not fire (not 403).

  describe('#1608 — wizard read-lookups, viewer gets past the guard (not 403)', () => {
    const FAKE_CONNECTION_ID = '00000000-0000-4000-8000-000000000001';

    it('GET /listings/connections/:connectionId/seller-policies', async () => {
      const { http, viewerToken } = await seeds();
      const res = await http
        .get(`/v1/listings/connections/${FAKE_CONNECTION_ID}/seller-policies`)
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(res.status).not.toBe(403);
    });

    it('GET /listings/connections/:connectionId/responsible-producers', async () => {
      const { http, viewerToken } = await seeds();
      const res = await http
        .get(`/v1/listings/connections/${FAKE_CONNECTION_ID}/responsible-producers`)
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(res.status).not.toBe(403);
    });

    it('GET /listings/connections/:connectionId/delivery-price-lists', async () => {
      const { http, viewerToken } = await seeds();
      const res = await http
        .get(`/v1/listings/connections/${FAKE_CONNECTION_ID}/delivery-price-lists`)
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(res.status).not.toBe(403);
    });

    it('GET /listings/connections/:connectionId/categories/:categoryId/parameters', async () => {
      const { http, viewerToken } = await seeds();
      const res = await http
        .get(`/v1/listings/connections/${FAKE_CONNECTION_ID}/categories/123/parameters`)
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(res.status).not.toBe(403);
    });

    it('POST /listings/connections/:connectionId/categories/resolve', async () => {
      const { http, viewerToken } = await seeds();
      const res = await http
        .post(`/v1/listings/connections/${FAKE_CONNECTION_ID}/categories/resolve`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({});
      expect(res.status).not.toBe(403);
    });

    it('POST /listings/connections/:connectionId/categories/resolve-batch', async () => {
      const { http, viewerToken } = await seeds();
      const res = await http
        .post(`/v1/listings/connections/${FAKE_CONNECTION_ID}/categories/resolve-batch`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ items: [] });
      expect(res.status).not.toBe(403);
    });

    it('POST /listings/connections/:connectionId/products/find-by-barcode', async () => {
      const { http, viewerToken } = await seeds();
      const res = await http
        .post(`/v1/listings/connections/${FAKE_CONNECTION_ID}/products/find-by-barcode`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ barcode: '5901234123457' });
      expect(res.status).not.toBe(403);
    });

    it('GET /listings/connections/:connectionId/products/:productId', async () => {
      const { http, viewerToken } = await seeds();
      const res = await http
        .get(`/v1/listings/connections/${FAKE_CONNECTION_ID}/products/p1`)
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(res.status).not.toBe(403);
    });

    // #1707 — the connection-edit seller-defaults section reads producers from
    // this Allegro-controller endpoint; it must match the listings sibling so a
    // non-admin editing a connection isn't 403'd with "Insufficient permissions".
    it('GET /integrations/allegro/connections/:id/responsible-producers', async () => {
      const { http, viewerToken } = await seeds();
      const res = await http
        .get(`/v1/integrations/allegro/connections/${FAKE_CONNECTION_ID}/responsible-producers`)
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(res.status).not.toBe(403);
    });
  });

  // ─── writes: viewer gets 403 ────────────────────────────────────────────────
  //
  // RolesGuard fires before the handler body, so these 403s arrive even with
  // empty or invalid request bodies — no seeded data required.

  describe('writes — viewer gets 403', () => {
    it('POST /connections', async () => {
      const { http, viewerToken } = await seeds();
      const dto = createPrestashopConnectionDto();
      await http
        .post('/v1/connections')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send(dto)
        .expect(403);
    });

    it('PATCH /connections/:id', async () => {
      const { http, adminToken, viewerToken } = await seeds();
      // Admin creates the connection; viewer is blocked on the update
      const dto = createPrestashopConnectionDto();
      const { body: conn } = await http
        .post('/v1/connections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(dto)
        .expect(201);
      await http
        .patch(`/v1/connections/${conn.id as string}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ name: 'should-be-blocked' })
        .expect(403);
    });

    it('POST /sync/jobs', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .post('/v1/sync/jobs')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ jobType: 'marketplace.orders.poll', connectionId: '00000000-0000-4000-8000-000000000001' })
        .expect(403);
    });

    it('POST /orders/:internalOrderId/destinations/:connectionId/retry', async () => {
      const { http, viewerToken } = await seeds();
      // Guard fires before the service lookup, so no order needs to exist
      await http
        .post('/v1/orders/fake-order-id/destinations/00000000-0000-4000-8000-000000000001/retry')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);
    });

    it('POST /listings/connections/:connectionId/offers', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .post('/v1/listings/connections/00000000-0000-4000-8000-000000000001/offers')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({})
        .expect(403);
    });

    it('POST /listings/connections/:connectionId/offers/:offerId/fields (#1608 — write stays admin/operator)', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .post(
          '/v1/listings/connections/00000000-0000-4000-8000-000000000001/offers/00000000-0000-4000-8000-000000000002/fields'
        )
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ price: '10.00' })
        .expect(403);
    });

    it('POST /listings/connections/:connectionId/sync/auto-match-variants (#1608 — write stays admin/operator)', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .post('/v1/listings/connections/00000000-0000-4000-8000-000000000001/sync/auto-match-variants')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({})
        .expect(403);
    });

    it('POST /listings/bulk-create (#1608 — bulk submit stays admin/operator)', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .post('/v1/listings/bulk-create')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({})
        .expect(403);
    });

    it('POST /sync/jobs/retry-grouped', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .post('/v1/sync/jobs/retry-grouped')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ connectionId: '00000000-0000-4000-8000-000000000001', jobType: 'marketplace.orders.poll' })
        .expect(403);
    });

    it('POST /invoices', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ orderId: 'fake-order-id' })
        .expect(403);
    });

    it('POST /invoices/retry', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .post('/v1/invoices/retry')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ invoiceIds: [] })
        .expect(403);
    });

    it('POST /invoices/:invoiceId/mark-paid (#1362)', async () => {
      const { http, viewerToken } = await seeds();
      // Guard fires before the handler, so a fake id still yields 403 (not 404).
      await http
        .post('/v1/invoices/00000000-0000-4000-8000-000000000009/mark-paid')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({})
        .expect(403);
    });

    it('POST /shipments/generate-label', async () => {
      const { http, viewerToken } = await seeds();
      await http
        .post('/v1/shipments/generate-label')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ orderId: 'fake-order-id' })
        .expect(403);
    });
  });

  // ─── config redaction ───────────────────────────────────────────────────────

  describe('config redaction — viewer gets {} for Connection.config', () => {
    it('GET /connections/:id returns {} config for viewer but full config for admin', async () => {
      const { http, adminToken, viewerToken } = await seeds();
      const dto = createPrestashopConnectionDto({
        config: { baseUrl: 'https://shop.example.com', shopId: 1, langId: 1 },
      });

      const { body: conn } = await http
        .post('/v1/connections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(dto)
        .expect(201);

      // Admin sees the raw config
      const adminGet = await http
        .get(`/v1/connections/${conn.id as string}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(adminGet.body.config).toEqual(dto.config);

      // Viewer gets an empty object
      const viewerGet = await http
        .get(`/v1/connections/${conn.id as string}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
      expect(viewerGet.body.config).toEqual({});
      // Other fields are still present
      expect(viewerGet.body.id).toBe(conn.id as string);
      expect(viewerGet.body.platformType).toBe('prestashop');
      expect(viewerGet.body.status).toBe('active');
    });

    it('GET /connections list returns {} config for every connection when called by viewer', async () => {
      const { http, adminToken, viewerToken } = await seeds();

      const dto1 = createPrestashopConnectionDto({ name: 'Store A' });
      const dto2 = createPrestashopConnectionDto({ name: 'Store B' });
      await http.post('/v1/connections').set('Authorization', `Bearer ${adminToken}`).send(dto1).expect(201);
      await http.post('/v1/connections').set('Authorization', `Bearer ${adminToken}`).send(dto2).expect(201);

      const { body: list } = await http
        .get('/v1/connections')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      expect(Array.isArray(list)).toBe(true);
      expect((list as { config: unknown }[]).length).toBeGreaterThanOrEqual(2);

      (list as { config: unknown }[]).forEach((connection) => {
        expect(connection.config).toEqual({});
      });
    });
  });
});
