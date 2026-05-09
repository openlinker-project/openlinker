/**
 * App Boot Integration Test
 *
 * Smoke test to verify the entire application wiring works correctly.
 * Tests that the Nest application boots, connects to database and Redis,
 * and basic endpoints are accessible.
 *
 * @module apps/api/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { IntegrationTestHarness } from './setup';
import {
  ADAPTER_REGISTRY_TOKEN,
  AdapterRegistryPort,
} from '@openlinker/core/integrations';

describe('App Boot Integration', () => {
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

  it('should boot Nest application and connect to database', async () => {
    const app = harness.getApp();
    const dataSource = harness.getDataSource();

    // Verify app is defined
    expect(app).toBeDefined();

    // Verify database connection is healthy
    const isConnected = dataSource.isInitialized;
    expect(isConnected).toBe(true);

    // Verify we can query the database
    const result = await dataSource.query('SELECT 1 as test');
    expect(result).toBeDefined();
    expect(result[0].test).toBe(1);
  });

  it('should respond to health endpoint', async () => {
    const http = harness.getHttp();

    const response = await http.get('/health').expect(200);

    expect(response.body).toBeDefined();
  });

  it('should self-register the bundled integration adapters at boot', async () => {
    // After #570/#571, AdapterRegistryService starts empty and each
    // *IntegrationModule.onModuleInit() registers its metadata. If a
    // future change breaks the boot-time registration call, this assertion
    // surfaces it directly rather than letting connection-scoped int-specs
    // fail with cryptic "no default adapter" errors downstream.
    const adapterRegistry = harness
      .getApp()
      .get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);

    const adapters = await adapterRegistry.listAdapters();
    const adapterKeys = adapters.map((a) => a.adapterKey);

    expect(adapterKeys).toEqual(
      expect.arrayContaining(['prestashop.webservice.v1', 'allegro.publicapi.v1']),
    );
    expect(await adapterRegistry.getDefaultAdapterKey('prestashop')).toBe(
      'prestashop.webservice.v1',
    );
    expect(await adapterRegistry.getDefaultAdapterKey('allegro')).toBe(
      'allegro.publicapi.v1',
    );
  });

  it('should have database tables created', async () => {
    const dataSource = harness.getDataSource();

    // Verify connections table exists
    const connectionsTable = await dataSource.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'connections'
      )
    `);
    expect(connectionsTable[0].exists).toBe(true);

    // Verify identifier_mappings table exists
    const mappingsTable = await dataSource.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'identifier_mappings'
      )
    `);
    expect(mappingsTable[0].exists).toBe(true);
  });
});







