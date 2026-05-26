/**
 * Fulfillment Routing HTTP Integration Test (#836)
 *
 * Vertical slice for the connection-scoped routing-rules API: the
 * `FulfillmentRoutingController` routes (GET / PUT / GET candidates) end-to-end
 * through the booted Nest app, real Postgres (Testcontainers), JWT auth and the
 * `@Roles('admin')` guard. Asserts the read-candidates / write-validation
 * symmetry (both driven by the shared compatibility predicate) and the domain
 * → HTTP exception mapping (incompatible → 400, unknown connection → 404).
 *
 * The service-level persistence / resolution semantics are covered separately
 * in `fulfillment-routing.int-spec.ts` — this spec owns the HTTP boundary.
 *
 * @module apps/api/test/integration
 */
import * as bcrypt from 'bcryptjs';
import { FULFILLMENT_PROCESSOR_KIND } from '@openlinker/core/mappings';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';
import { createTestConnection } from './helpers/test-connection.helper';

interface SeededConnections {
  /** Allegro order source (`allegro.publicapi.v1` — OrderSource / OfferManager). */
  sourceId: string;
  /** PrestaShop OMP (`prestashop.webservice.v1` — OrderProcessorManager). */
  prestashopId: string;
  /** InPost OL-managed carrier (`inpost.shipx.v1` — ShippingProviderManager). */
  inpostId: string;
}

describe('Fulfillment Routing HTTP Integration', () => {
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

  async function seedConnections(): Promise<SeededConnections> {
    const dataSource = harness.getDataSource();
    const source = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.publicapi.v1',
      enabledCapabilities: ['OrderSource'],
    });
    const prestashop = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      name: 'PrestaShop OMP',
      adapterKey: 'prestashop.webservice.v1',
      enabledCapabilities: ['OrderProcessorManager'],
    });
    const inpost = await createTestConnection(dataSource, {
      platformType: 'inpost',
      name: 'InPost carrier',
      adapterKey: 'inpost.shipx.v1',
      enabledCapabilities: ['ShippingProviderManager'],
    });
    return { sourceId: source.id, prestashopId: prestashop.id, inpostId: inpost.id };
  }

  async function loginAsViewer(username = 'viewer'): Promise<string> {
    const passwordHash = await bcrypt.hash('viewer-pass', 4);
    await harness.getDataSource().query(
      `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, 'viewer')`,
      [username, `${username}@example.com`, passwordHash],
    );
    const response = await harness
      .getHttp()
      .post('/auth/login')
      .send({ username, password: 'viewer-pass' })
      .expect(200);
    return response.body.access_token as string;
  }

  it('round-trips rules through PUT then GET', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());
    const { sourceId, prestashopId, inpostId } = await seedConnections();

    // Empty before any write.
    const initial = await http
      .get(`/connections/${sourceId}/routing-rules`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(initial.body).toEqual([]);

    const putRes = await http
      .put(`/connections/${sourceId}/routing-rules`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [
          {
            sourceDeliveryMethodId: 'allegro-courier',
            processorKind: FULFILLMENT_PROCESSOR_KIND.OmpFulfilled,
            processorConnectionId: prestashopId,
          },
          {
            sourceDeliveryMethodId: 'allegro-one-box',
            processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
            processorConnectionId: inpostId,
          },
        ],
      })
      .expect(200);
    expect(putRes.body).toHaveLength(2);

    const getRes = await http
      .get(`/connections/${sourceId}/routing-rules`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const byMethod = new Map<string, { processorKind: string; processorConnectionId: string }>(
      (getRes.body as { sourceDeliveryMethodId: string; processorKind: string; processorConnectionId: string }[]).map(
        (r) => [r.sourceDeliveryMethodId, r],
      ),
    );
    expect(byMethod.get('allegro-courier')).toMatchObject({
      processorKind: 'omp_fulfilled',
      processorConnectionId: prestashopId,
    });
    expect(byMethod.get('allegro-one-box')).toMatchObject({
      processorKind: 'ol_managed_carrier',
      processorConnectionId: inpostId,
    });
  });

  it('lists the capability-compatible candidates for the source connection', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());
    const { sourceId, prestashopId, inpostId } = await seedConnections();

    const res = await http
      .get(`/connections/${sourceId}/routing-rules/candidates`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const candidates = res.body as { processorKind: string; processorConnectionId: string }[];
    // PrestaShop is the OMP-capable processor; InPost the OL-managed shipping
    // carrier; and since #833 the Allegro source itself declares
    // ShippingProviderManager, so it is a source_brokered candidate (a
    // source-brokered processor is the source connection itself).
    expect(candidates).toEqual(
      expect.arrayContaining([
        { processorKind: 'omp_fulfilled', processorConnectionId: prestashopId },
        { processorKind: 'ol_managed_carrier', processorConnectionId: inpostId },
        { processorKind: 'source_brokered', processorConnectionId: sourceId },
      ]),
    );
    expect(candidates).toHaveLength(3);
  });

  it('rejects an incompatible processor with 400', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());
    const { sourceId } = await seedConnections();

    // Routing an OMP rule at the Allegro source itself — Allegro does not
    // declare OrderProcessorManager.
    await http
      .put(`/connections/${sourceId}/routing-rules`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [
          {
            sourceDeliveryMethodId: 'allegro-courier',
            processorKind: FULFILLMENT_PROCESSOR_KIND.OmpFulfilled,
            processorConnectionId: sourceId,
          },
        ],
      })
      .expect(400);
  });

  it('returns 404 when listing candidates for an unknown connection', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    await http
      .get('/connections/ol_connection_does_not_exist/routing-rules/candidates')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('rejects a non-admin caller with 403', async () => {
    const http = harness.getHttp();
    const { sourceId } = await seedConnections();
    const viewerToken = await loginAsViewer();

    await http
      .get(`/connections/${sourceId}/routing-rules`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);
  });
});
