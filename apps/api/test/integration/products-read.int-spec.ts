/**
 * Products Read API Integration Test
 *
 * Vertical slice covering `currency` persistence round-trip for #358:
 * seed → `GET /products` → assert the field survives ORM ↔ domain ↔ DTO mapping
 * without loss (both a populated ISO 4217 code and the null case).
 *
 * Uses real Postgres via Testcontainers.
 *
 * @module apps/api/test/integration
 */
import { DataSource } from 'typeorm';
import {
  Product,
  ProductOrmEntity,
  ProductRepositoryPort,
  PRODUCT_REPOSITORY_TOKEN,
} from '@openlinker/core/products';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';

interface SeedProductOverrides {
  id?: string;
  name?: string;
  sku?: string | null;
  price?: number | null;
  currency?: string | null;
}

async function seedProduct(
  dataSource: DataSource,
  overrides: SeedProductOverrides = {},
): Promise<ProductOrmEntity> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const repo = dataSource.getRepository(ProductOrmEntity);
  const entity = repo.create({
    id: `ol_product_fixture_${suffix}`,
    name: 'Test Product',
    sku: 'SKU-FIX',
    price: 29.99,
    currency: null,
    description: null,
    images: null,
    ...overrides,
  });
  return repo.save(entity);
}

describe('Products Read API Integration — currency persistence', () => {
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

  it('should surface persisted currency through GET /products', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);

    const seeded = await seedProduct(dataSource, { currency: 'PLN' });

    const response = await http
      .get('/products')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const item = response.body.items.find(
      (p: { id: string; currency: string | null }) => p.id === seeded.id,
    );
    expect(item).toBeDefined();
    expect(item.currency).toBe('PLN');
  });

  it('should return null currency when the column is null', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);

    const seeded = await seedProduct(dataSource, { currency: null });

    const response = await http
      .get('/products')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const item = response.body.items.find(
      (p: { id: string; currency: string | null }) => p.id === seeded.id,
    );
    expect(item).toBeDefined();
    expect(item.currency).toBeNull();
  });

  it('should persist currency via ProductRepository.upsert (domain → ORM)', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);

    const repo = harness
      .getApp()
      .get<ProductRepositoryPort>(PRODUCT_REPOSITORY_TOKEN);
    const domainProduct: Product = {
      id: `ol_product_upsert_${Date.now()}`,
      name: 'Upsert Roundtrip',
      sku: 'SKU-UPSERT',
      price: 42.5,
      currency: 'PLN',
      description: null,
      images: null,
    };

    await repo.upsert(domainProduct);

    const response = await http
      .get('/products')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const item = response.body.items.find(
      (p: { id: string; currency: string | null }) => p.id === domainProduct.id,
    );
    expect(item).toBeDefined();
    expect(item.currency).toBe('PLN');
  });
});
