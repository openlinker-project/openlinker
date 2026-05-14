/**
 * Inventory Read API Integration Test
 *
 * Vertical slice tests for the inventory read API:
 * GET /inventory — list with pagination and filters
 * GET /inventory/:id — detail view
 *
 * Uses real Postgres via Testcontainers.
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
import { createTestInventoryItem } from './fixtures/inventory.fixtures';

describe('Inventory Read API Integration', () => {
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

  describe('GET /inventory', () => {
    it('should return empty list when no inventory items exist', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const response = await http
        .get('/inventory')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.items).toEqual([]);
      expect(response.body.total).toBe(0);
    });

    it('should return seeded inventory items with correct shape', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const item = await createTestInventoryItem(dataSource, {
        availableQuantity: 42,
        reservedQuantity: 5,
      });

      const response = await http
        .get('/inventory')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.items).toHaveLength(1);

      const body = response.body.items[0];
      expect(body.id).toBe(item.id);
      expect(body.productId).toBe(item.productId);
      expect(body.availableQuantity).toBe(42);
      expect(body.reservedQuantity).toBe(5);
      expect(body.updatedAt).toBeDefined();
    });

    it('should filter by productId', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const item1 = await createTestInventoryItem(dataSource);
      await createTestInventoryItem(dataSource);

      const response = await http
        .get(`/inventory?productId=${item1.productId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.items[0].productId).toBe(item1.productId);
    });

    it('should filter by locationId', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await createTestInventoryItem(dataSource, { locationId: 'warehouse-a' });
      await createTestInventoryItem(dataSource, { locationId: 'warehouse-b' });

      const response = await http
        .get('/inventory?locationId=warehouse-a')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.items[0].locationId).toBe('warehouse-a');
    });

    it('should paginate results with limit and offset', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      for (let i = 0; i < 5; i++) {
        await createTestInventoryItem(dataSource);
      }

      const page1 = await http
        .get('/inventory?limit=2&offset=0')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.total).toBe(5);
      expect(page1.body.limit).toBe(2);
      expect(page1.body.offset).toBe(0);

      const page2 = await http
        .get('/inventory?limit=2&offset=2')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(page2.body.items).toHaveLength(2);
      expect(page2.body.total).toBe(5);

      // Pages must not overlap
      const ids1 = page1.body.items.map((i: { id: string }) => i.id) as string[];
      const ids2 = page2.body.items.map((i: { id: string }) => i.id) as string[];
      expect(ids1.some((id) => ids2.includes(id))).toBe(false);
    });

    it('should return 401 without token', async () => {
      const http = harness.getHttp();
      await http.get('/inventory').expect(401);
    });

    it('should surface the cover image URL from the parent product', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const item = await createTestInventoryItem(dataSource, undefined, {
        images: [
          'https://shop.test/img/p/1/1-home_default.jpg',
          'https://shop.test/img/p/1/1-medium_default.jpg',
        ],
      });

      const response = await http
        .get('/inventory')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body.items.find((row: { id: string }) => row.id === item.id);
      expect(body).toBeDefined();
      expect(body.productImageUrl).toBe('https://shop.test/img/p/1/1-home_default.jpg');
    });

    it('should return null productImageUrl when the parent product has no images', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const item = await createTestInventoryItem(dataSource, undefined, { images: null });

      const response = await http
        .get('/inventory')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body.items.find((row: { id: string }) => row.id === item.id);
      expect(body).toBeDefined();
      expect(body.productImageUrl).toBeNull();
    });
  });

  describe('GET /inventory/:id', () => {
    it('should return inventory item detail by id', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const item = await createTestInventoryItem(dataSource, { availableQuantity: 7 });

      const response = await http
        .get(`/inventory/${item.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.id).toBe(item.id);
      expect(response.body.availableQuantity).toBe(7);
    });

    it('should return 404 for non-existent inventory item', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .get('/inventory/ol_inventory_nonexistent')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should return 401 without token', async () => {
      const http = harness.getHttp();
      await http.get('/inventory/ol_inventory_nonexistent').expect(401);
    });
  });
});
