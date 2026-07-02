/**
 * Connection Capabilities Integration Test
 *
 * Verifies the `enabledCapabilities` gate end-to-end:
 *   - Create defaults enabledCapabilities to the adapter's full supported set.
 *   - GET / LIST expose `enabledCapabilities` and derived `supportedCapabilities`.
 *   - PATCH can narrow the enabled set and rejects values outside the adapter's
 *     supported set.
 *   - PATCH cannot change `adapterKey`.
 *   - Capability validation at create time rejects unsupported values.
 *
 * @module apps/api/test/integration
 */
import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
  IntegrationTestHarness,
} from './setup';
import { createPrestashopConnectionDto } from './fixtures/connection.fixtures';
import { loginAsAdmin } from './helpers/test-auth.helper';

describe('Connection Capabilities Integration', () => {
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

  async function createConnection(
    body: object,
    token?: string
  ): Promise<{ id: string; enabledCapabilities: string[]; supportedCapabilities: string[] }> {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const authToken = token ?? (await loginAsAdmin(http, dataSource));
    const response = await http
      .post('/v1/connections')
      .set('Authorization', `Bearer ${authToken}`)
      .send(body)
      .expect(201);
    return response.body;
  }

  it('defaults enabledCapabilities to the adapter full supported set', async () => {
    const dto = createPrestashopConnectionDto({ name: 'Default caps store' });
    const created = await createConnection(dto);

    expect(created.supportedCapabilities.sort()).toEqual([
      'CategoryProvisioner',
      'InventoryMaster',
      'OrderProcessorManager',
      'OrderSource',
      'ProductMaster',
      'ProductPublisher',
    ]);
    expect(created.enabledCapabilities.sort()).toEqual(created.supportedCapabilities.sort());
  });

  it('respects explicit enabledCapabilities on create and validates subset', async () => {
    const dto = createPrestashopConnectionDto({
      name: 'Destination only',
      enabledCapabilities: ['ProductMaster', 'OrderProcessorManager'],
    } as Record<string, unknown>);
    const created = await createConnection(dto);

    expect(created.enabledCapabilities.sort()).toEqual(['OrderProcessorManager', 'ProductMaster']);
  });

  it('rejects create with a capability the adapter does not support', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);

    const dto = createPrestashopConnectionDto({
      name: 'Bad caps',
      enabledCapabilities: ['ProductMaster', 'OfferManager'], // Marketplace not supported by prestashop.webservice.v1
    } as Record<string, unknown>);

    await http.post('/v1/connections').set('Authorization', `Bearer ${token}`).send(dto).expect(400);
  });

  it('allows PATCH to narrow enabledCapabilities', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);

    const created = await createConnection(
      createPrestashopConnectionDto({ name: 'Narrow me' }),
      token
    );

    const updated = await http
      .patch(`/v1/connections/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabledCapabilities: ['ProductMaster'] })
      .expect(200);

    expect(updated.body.enabledCapabilities).toEqual(['ProductMaster']);
    expect(updated.body.supportedCapabilities.sort()).toEqual([
      'CategoryProvisioner',
      'InventoryMaster',
      'OrderProcessorManager',
      'OrderSource',
      'ProductMaster',
      'ProductPublisher',
    ]);
  });

  it('rejects PATCH that changes adapterKey', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);

    const created = await createConnection(
      createPrestashopConnectionDto({ name: 'Immutable key' }),
      token
    );

    await http
      .patch(`/v1/connections/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ adapterKey: 'prestashop.webservice.v2' })
      .expect(400);
  });

  it('rejects PATCH with an unsupported capability', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);

    const created = await createConnection(
      createPrestashopConnectionDto({ name: 'Validate subset' }),
      token
    );

    await http
      .patch(`/v1/connections/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabledCapabilities: ['OfferManager'] })
      .expect(400);
  });
});
