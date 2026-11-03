/**
 * Product Repository — mapping unit tests
 *
 * Verifies the ORM ↔ domain mapping round-trips the fields that are easy to
 * silently drop - here the #1752 `features` column (product-level attributes)
 * and the `gpsr` column, whose three-state contract (undefined / null / value)
 * the repository is the only place to keep.
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
  describe('gpsr', () => {
    const gpsr = {
      producer: {
        name: 'Acme Sp. z o.o.',
        email: 'safety@acme.example',
        address: { street: 'Prosta 1', postalCode: '00-001', city: 'Warszawa', countryCode: 'PL' },
      },
      safetyInformation: { text: 'Keep away from children.', certificateNames: ['CE'] },
    };

    it('should round-trip gpsr through upsert when the master stated it', async () => {
      const saved = await repository.upsert(baseProduct({ gpsr }));

      expect(ormRepo.save.mock.calls[0][0].gpsr).toEqual(gpsr);
      expect(saved.gpsr).toEqual(gpsr);
    });

    it('should write a null gpsr when the master reported the product has none', async () => {
      await repository.upsert(baseProduct({ gpsr: null }));

      expect(ormRepo.save.mock.calls[0][0].gpsr).toBeNull();
    });

    it('should leave the gpsr column off the write when the master did not report it', async () => {
      // An undefined property is skipped by TypeORM, so a stored declaration
      // survives a sync whose GPSR reference read failed.
      const saved = await repository.upsert(baseProduct());

      expect(ormRepo.save.mock.calls[0][0].gpsr).toBeUndefined();
      expect(saved.gpsr).toBeUndefined();
    });

    it('should drop a nameless party when loading a malformed stored value', async () => {
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
        gpsr: { producer: { email: 'x@y.example' }, importer: { name: ' Imp ' } },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      ormRepo.findOne.mockResolvedValue(entity);

      const product = await repository.findById('ol_product_1');

      expect(product?.gpsr).toEqual({ importer: { name: 'Imp' } });
    });
  });
});
