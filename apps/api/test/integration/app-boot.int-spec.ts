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



