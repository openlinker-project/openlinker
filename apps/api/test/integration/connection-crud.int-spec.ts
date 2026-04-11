/**
 * Connection CRUD Integration Test
 *
 * Vertical slice test verifying full HTTP → Controller → Service → Repository → DB flow.
 * Tests connection creation, retrieval, updating, and deletion with real database.
 *
 * @module apps/api/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { IntegrationTestHarness } from './setup';
import { createPrestashopConnectionDto } from './fixtures/connection.fixtures';
import { getConnectionById, countConnections } from './helpers/test-database.helper';
import { loginAsAdmin } from './helpers/test-auth.helper';

describe('Connection CRUD Integration', () => {
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

  describe('POST /connections', () => {
    it('should create connection and persist to database', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const dto = createPrestashopConnectionDto({
        name: 'My PrestaShop Store',
      });

      // Create connection via HTTP
      const response = await http
        .post('/connections')
        .set('Authorization', `Bearer ${token}`)
        .send(dto)
        .expect(201);

      // Verify response
      expect(response.body).toBeDefined();
      expect(response.body.id).toBeDefined();
      expect(response.body.platformType).toBe('prestashop');
      expect(response.body.name).toBe('My PrestaShop Store');
      expect(response.body.status).toBe('active');
      expect(response.body.config).toEqual(dto.config);
      expect(response.body.createdAt).toBeDefined();
      expect(response.body.updatedAt).toBeDefined();

      // Verify connection exists in database
      const connection = await getConnectionById(dataSource, response.body.id);
      expect(connection).toBeDefined();
      expect(connection?.platformType).toBe('prestashop');
      expect(connection?.name).toBe('My PrestaShop Store');
      expect(connection?.status).toBe('active');
      expect(connection?.config).toEqual(dto.config);
      expect(connection?.credentialsRef).toBe(dto.credentialsRef);
      expect(connection?.adapterKey).toBe(dto.adapterKey);
    });

    it('should validate required fields', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      // Missing required fields
      await http
        .post('/connections')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
    });

    it('should return 401 without token', async () => {
      const http = harness.getHttp();
      await http.post('/connections').send({}).expect(401);
    });
  });

  describe('GET /connections/:id', () => {
    it('should retrieve connection from database', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      // Create connection via HTTP
      const dto = createPrestashopConnectionDto();
      const createResponse = await http
        .post('/connections')
        .set('Authorization', `Bearer ${token}`)
        .send(dto)
        .expect(201);
      const connectionId = createResponse.body.id;

      // Retrieve connection via HTTP
      const getResponse = await http
        .get(`/connections/${connectionId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Verify response matches database
      expect(getResponse.body.id).toBe(connectionId);
      expect(getResponse.body.platformType).toBe('prestashop');

      // Verify database state
      const connection = await getConnectionById(dataSource, connectionId);
      expect(connection).toBeDefined();
      expect(connection?.id).toBe(connectionId);
    });

    it('should return 404 for non-existent connection', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .get('/connections/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should return 401 without token', async () => {
      const http = harness.getHttp();
      await http.get('/connections/00000000-0000-4000-8000-000000000000').expect(401);
    });
  });

  describe('GET /connections', () => {
    it('should list all connections', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      // Create multiple connections
      const dto1 = createPrestashopConnectionDto({ name: 'Store 1' });
      const dto2 = createPrestashopConnectionDto({ name: 'Store 2' });

      await http.post('/connections').set('Authorization', `Bearer ${token}`).send(dto1).expect(201);
      await http.post('/connections').set('Authorization', `Bearer ${token}`).send(dto2).expect(201);

      // List connections
      const response = await http
        .get('/connections')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Verify response
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(2);

      // Verify database count matches
      const dbCount = await countConnections(dataSource);
      expect(dbCount).toBeGreaterThanOrEqual(2);
    });

    it('should filter connections by platformType', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      // Create connections with different platform types
      const prestashopDto = createPrestashopConnectionDto({ name: 'PrestaShop Store' });
      await http
        .post('/connections')
        .set('Authorization', `Bearer ${token}`)
        .send(prestashopDto)
        .expect(201);

      // Filter by platformType
      const response = await http
        .get('/connections')
        .set('Authorization', `Bearer ${token}`)
        .query({ platformType: 'prestashop' })
        .expect(200);

      // Verify all returned connections are PrestaShop
      expect(Array.isArray(response.body)).toBe(true);
      response.body.forEach((conn: { platformType: string }) => {
        expect(conn.platformType).toBe('prestashop');
      });
    });
  });

  describe('PATCH /connections/:id', () => {
    it('should update connection in database', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      // Create connection
      const dto = createPrestashopConnectionDto();
      const createResponse = await http
        .post('/connections')
        .set('Authorization', `Bearer ${token}`)
        .send(dto)
        .expect(201);
      const connectionId = createResponse.body.id;

      // Update connection
      const updateDto = {
        name: 'Updated Store Name',
        config: { baseUrl: 'https://updated.example.com' },
      };

      const updateResponse = await http
        .patch(`/connections/${connectionId}`)
        .set('Authorization', `Bearer ${token}`)
        .send(updateDto)
        .expect(200);

      // Verify response
      expect(updateResponse.body.name).toBe('Updated Store Name');
      expect(updateResponse.body.config.baseUrl).toBe('https://updated.example.com');

      // Verify database updated
      const connection = await getConnectionById(dataSource, connectionId);
      expect(connection?.name).toBe('Updated Store Name');
      expect(connection?.config.baseUrl).toBe('https://updated.example.com');
      expect(connection?.updatedAt.getTime()).toBeGreaterThan(
        connection?.createdAt.getTime() || 0,
      );
    });
  });
});
