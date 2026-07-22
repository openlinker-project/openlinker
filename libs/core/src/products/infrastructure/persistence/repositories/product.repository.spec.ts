/**
 * Product Repository — mapping unit tests
 *
 * Verifies the ORM ↔ domain mapping round-trips the fields that are easy to
 * silently drop — here the #1752 `features` column (product-level attributes).
 */
import type { Repository } from 'typeorm';
import { ProductRepository } from './product.repository';
import { ProductOrmEntity } from '../entities/product.orm-entity';
import type { Product } from '../../../domain/entities/product.entity';

function baseProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'ol_product_1',
    name: 'Test',
    sku: 'SKU-1',
    price: 10,
    currency: 'PLN',
    description: null,
    images: null,
    ...overrides,
  };
}

describe('ProductRepository mapping', () => {
  let ormRepo: jest.Mocked<Repository<ProductOrmEntity>>;
  let repository: ProductRepository;

  beforeEach(() => {
    ormRepo = {
      // save persists the ORM entity produced by toOrmEntity and echoes it back,
      // so upsert exercises toOrmEntity → save → toDomain (a full round-trip).
      save: jest.fn((entity: ProductOrmEntity) => Promise.resolve(entity)),
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<ProductOrmEntity>>;
    repository = new ProductRepository(ormRepo);
  });

  it('should round-trip features through upsert', async () => {
    const features = [
      { name: 'Brand', value: 'Acme' },
      { name: 'Material', value: 'Ceramic' },
    ];

    const saved = await repository.upsert(baseProduct({ features }));

    // Persisted onto the ORM entity...
    const persisted = ormRepo.save.mock.calls[0][0];
    expect(persisted.features).toEqual(features);
    // ...and surfaced back on the domain entity.
    expect(saved.features).toEqual(features);
  });

  it('should persist null features when absent', async () => {
    await repository.upsert(baseProduct());

    const persisted = ormRepo.save.mock.calls[0][0];
    expect(persisted.features).toBeNull();
  });

  it('should omit features on load when the column is null', async () => {
    const entity = new ProductOrmEntity();
    Object.assign(entity, {
      id: 'ol_product_1',
      name: 'Test',
      sku: null,
      price: null,
      currency: null,
      description: null,
      images: null,
      categories: null,
      features: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    ormRepo.findOne.mockResolvedValue(entity);

    const product = await repository.findById('ol_product_1');

    expect(product?.features).toBeUndefined();
  });
});
