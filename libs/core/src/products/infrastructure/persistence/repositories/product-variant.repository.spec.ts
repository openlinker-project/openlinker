/**
 * Product Variant Repository — physical-data fill unit tests
 *
 * Pins the shape of the fill-when-NULL writer (#3650): one statement for all
 * of a product's variants, every value bound as a parameter, and the filled
 * count read from the RETURNING rows. The COALESCE / WHERE semantics
 * themselves are exercised against real Postgres in
 * `apps/api/test/integration/product-variant-physical-fill.int-spec.ts`.
 */
import type { Repository } from 'typeorm';
import { ProductVariantRepository } from './product-variant.repository';
import type { ProductVariantOrmEntity } from '../entities/product-variant.orm-entity';
import type { ProductVariant } from '../../../domain/entities/product-variant.entity';

describe('ProductVariantRepository.fillPhysicalDimensionsIfAbsent', () => {
  let ormRepo: { query: jest.Mock };
  let repository: ProductVariantRepository;

  beforeEach(() => {
    ormRepo = { query: jest.fn().mockResolvedValue([[], 0]) };
    repository = new ProductVariantRepository(
      ormRepo as unknown as Repository<ProductVariantOrmEntity>
    );
  });

  it('should return 0 without a round-trip when no variant carries a numeric field', async () => {
    await expect(repository.fillPhysicalDimensionsIfAbsent([])).resolves.toBe(0);
    await expect(
      repository.fillPhysicalDimensionsIfAbsent([
        { variantId: 'ol_variant_1', weightGrams: null },
        { variantId: 'ol_variant_2' },
      ])
    ).resolves.toBe(0);

    expect(ormRepo.query).not.toHaveBeenCalled();
  });

  it('should write every variant in one statement with all values bound as parameters', async () => {
    await repository.fillPhysicalDimensionsIfAbsent([
      { variantId: 'ol_variant_1', weightGrams: 701, heightMm: 102 },
      { variantId: 'ol_variant_2', weightGrams: null },
      { variantId: 'ol_variant_3', lengthMm: 303, widthMm: 204 },
    ]);

    expect(ormRepo.query).toHaveBeenCalledTimes(1);
    const [sql, params] = ormRepo.query.mock.calls[0] as [string, unknown[]];
    // The variant with nothing numeric is dropped; absent fields bind as NULL.
    expect(params).toEqual([
      'ol_variant_1',
      701,
      null,
      null,
      102,
      'ol_variant_3',
      null,
      303,
      204,
      null,
    ]);
    expect(sql).toContain('UPDATE "product_variants" AS pv');
    expect(sql).toContain('FROM (VALUES ($1::text, $2::int, $3::int, $4::int, $5::int), ($6::text');
    expect(sql).toContain('"weightGrams" = COALESCE(pv."weightGrams", v."weightGrams")');
    expect(sql).toContain('(pv."heightMm" IS NULL AND v."heightMm" IS NOT NULL)');
    for (const value of ['ol_variant_1', 'ol_variant_3', '701', '303', '204', '102']) {
      expect(sql).not.toContain(value);
    }
  });

  it('should count the RETURNING rows when the driver reports [rows, affected]', async () => {
    ormRepo.query.mockResolvedValueOnce([[{ id: 'ol_variant_1' }, { id: 'ol_variant_3' }], 2]);

    const filled = await repository.fillPhysicalDimensionsIfAbsent([
      { variantId: 'ol_variant_1', weightGrams: 700 },
      { variantId: 'ol_variant_2', weightGrams: 800 },
      { variantId: 'ol_variant_3', weightGrams: 900 },
    ]);

    expect(filled).toBe(2);
  });

  it('should count the rows when the driver returns the plain row array', async () => {
    ormRepo.query.mockResolvedValueOnce([{ id: 'ol_variant_1' }]);

    const filled = await repository.fillPhysicalDimensionsIfAbsent([
      { variantId: 'ol_variant_1', weightGrams: 700 },
    ]);

    expect(filled).toBe(1);
  });
});

/**
 * ADR-077 - `priceBasisPending` is set only by the migration and cleared only by
 * `clearPriceBasisPending`, which the master sync calls once the corrected
 * price was reported. An upsert never writes the column, so a report that
 * failed leaves the variant pending.
 */
describe('ProductVariantRepository priceBasisPending (ADR-077)', () => {
  let ormRepo: { save: jest.Mock; findOne: jest.Mock; createQueryBuilder: jest.Mock };
  let qb: { update: jest.Mock; set: jest.Mock; where: jest.Mock; andWhere: jest.Mock; execute: jest.Mock };
  let repository: ProductVariantRepository;

  const baseVariant: ProductVariant = {
    id: 'ol_variant_1',
    productId: 'ol_product_1',
    sku: 'SKU-1',
    attributes: null,
    ean: null,
    gtin: null,
  };

  const savedEntity = (): ProductVariantOrmEntity =>
    (ormRepo.save.mock.calls as ProductVariantOrmEntity[][])[0][0];

  beforeEach(() => {
    qb = {
      update: jest.fn(),
      set: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    qb.update.mockReturnValue(qb);
    qb.set.mockReturnValue(qb);
    qb.where.mockReturnValue(qb);
    qb.andWhere.mockReturnValue(qb);
    ormRepo = {
      save: jest.fn((entity: ProductVariantOrmEntity) => Promise.resolve(entity)),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    repository = new ProductVariantRepository(
      ormRepo as unknown as Repository<ProductVariantOrmEntity>
    );
  });

  it('should map priceBasisPending from the stored row when reading a variant', async () => {
    ormRepo.findOne.mockResolvedValue({
      id: 'ol_variant_1',
      productId: 'ol_product_1',
      sku: 'SKU-1',
      attributes: null,
      ean: null,
      gtin: null,
      price: '100.00',
      isStale: false,
      staleAt: null,
      priceBasisPending: true,
      taxRate: null,
      taxRateCountry: null,
      taxRateReadAt: null,
      taxRateUnknownReason: null,
      weightGrams: null,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      createdAt: new Date('2026-10-01T00:00:00Z'),
      updatedAt: new Date('2026-10-01T00:00:00Z'),
    });

    const variant = await repository.findById('ol_variant_1');

    expect(variant?.priceBasisPending).toBe(true);
    expect(variant?.price).toBe(100);
  });

  it.each([
    ['carries a price', 123],
    ['carries no price', undefined],
  ])('should leave priceBasisPending out of the write when the upsert %s', async (_label, price) => {
    await repository.upsert({ ...baseVariant, price });

    expect(ormRepo.save).toHaveBeenCalledTimes(1);
    expect(savedEntity().priceBasisPending).toBeUndefined();
  });

  it('should clear the flag only on pending rows of the given variants when asked to', async () => {
    await repository.clearPriceBasisPending(['ol_variant_1', 'ol_variant_2']);

    expect(qb.set).toHaveBeenCalledWith({ priceBasisPending: false });
    expect(qb.where).toHaveBeenCalledWith('id IN (:...ids)', {
      ids: ['ol_variant_1', 'ol_variant_2'],
    });
    expect(qb.andWhere).toHaveBeenCalledWith('priceBasisPending = true');
    expect(qb.execute).toHaveBeenCalledTimes(1);
  });

  it('should not query when asked to clear no variants', async () => {
    await repository.clearPriceBasisPending([]);

    expect(ormRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
});

/**
 * Variant images: master-derived like `attributes`, so the sync upsert owns the
 * column - it writes what the master reported, and `null` when it reported
 * nothing, so a picture removed at the master does not linger.
 */
describe('ProductVariantRepository images', () => {
  let ormRepo: { save: jest.Mock; findOne: jest.Mock };
  let repository: ProductVariantRepository;

  const baseVariant: ProductVariant = {
    id: 'ol_variant_1',
    productId: 'ol_product_1',
    sku: 'SKU-1',
    attributes: { Kolor: 'czerwony' },
    ean: null,
    gtin: null,
  };

  const savedEntity = (): ProductVariantOrmEntity =>
    (ormRepo.save.mock.calls as ProductVariantOrmEntity[][])[0][0];

  beforeEach(() => {
    ormRepo = {
      save: jest.fn((entity: ProductVariantOrmEntity) => Promise.resolve(entity)),
      findOne: jest.fn(),
    };
    repository = new ProductVariantRepository(
      ormRepo as unknown as Repository<ProductVariantOrmEntity>
    );
  });

  it('should write the images the master reported for the variant', async () => {
    await repository.upsert({ ...baseVariant, images: ['https://shop/gfx/314.jpg'] });

    expect(savedEntity().images).toEqual(['https://shop/gfx/314.jpg']);
  });

  it.each([
    ['reported null', null],
    ['reported nothing', undefined],
  ])('should clear the column when the master %s', async (_label, images) => {
    await repository.upsert({ ...baseVariant, images });

    expect(savedEntity().images).toBeNull();
  });

  it('should read the stored images back onto the variant', async () => {
    ormRepo.findOne.mockResolvedValue({
      ...baseVariant,
      price: null,
      images: ['https://shop/gfx/314.jpg'],
      isStale: false,
      staleAt: null,
      priceBasisPending: false,
      taxRate: null,
      taxRateCountry: null,
      taxRateReadAt: null,
      taxRateUnknownReason: null,
      weightGrams: null,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      createdAt: new Date('2026-10-01T00:00:00Z'),
      updatedAt: new Date('2026-10-01T00:00:00Z'),
    });

    const variant = await repository.findById('ol_variant_1');

    expect(variant?.images).toEqual(['https://shop/gfx/314.jpg']);
  });
});

describe('ProductVariantRepository cost (#3588)', () => {
  let ormRepo: { save: jest.Mock; query: jest.Mock; update: jest.Mock; find: jest.Mock };
  let repository: ProductVariantRepository;

  beforeEach(() => {
    ormRepo = {
      save: jest.fn((entity: ProductVariantOrmEntity) => Promise.resolve(entity)),
      query: jest.fn().mockResolvedValue([[], 0]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
    };
    repository = new ProductVariantRepository(
      ormRepo as unknown as Repository<ProductVariantOrmEntity>
    );
  });

  it('should carry no cost key when the master-sync upsert writes a variant', async () => {
    await repository.upsert({
      id: 'v1',
      productId: 'p1',
      sku: null,
      attributes: null,
      ean: null,
      gtin: null,
      netUnitCost: '9.9900',
      costCurrency: 'PLN',
      costUpdatedAt: new Date(),
      costUpdatedByUserId: 'someone',
    });

    const saved = (ormRepo.save.mock.calls as ProductVariantOrmEntity[][])[0][0];
    for (const key of ['netUnitCost', 'costCurrency', 'costUpdatedAt', 'costUpdatedByUserId']) {
      expect(Object.keys(saved)).not.toContain(key);
    }
  });

  it('should stamp provenance and report whether the variant exists in recordCost', async () => {
    await expect(
      repository.recordCost('v1', { netUnitCost: '1.00', currency: 'PLN' }, 'u1')
    ).resolves.toBe(true);
    expect(ormRepo.update).toHaveBeenCalledWith(
      { id: 'v1' },
      expect.objectContaining({
        netUnitCost: '1.00',
        costCurrency: 'PLN',
        costUpdatedByUserId: 'u1',
        costUpdatedAt: expect.any(Date) as Date,
      })
    );

    ormRepo.update.mockResolvedValue({ affected: 0 });
    await expect(repository.recordCost('x', null, 'u1')).resolves.toBe(false);
  });

  it('should write NULLs for both cost columns when clearing', async () => {
    await repository.recordCost('v1', null, 'u1');

    expect(ormRepo.update).toHaveBeenCalledWith(
      { id: 'v1' },
      expect.objectContaining({ netUnitCost: null, costCurrency: null })
    );
  });

  it('should bucket ids into filled, skippedAlreadySet and notFound', async () => {
    ormRepo.query.mockResolvedValue([[{ id: 'a' }], 1]);
    ormRepo.find.mockResolvedValue([{ id: 'b' }]);

    const result = await repository.fillCostIfAbsent(
      ['a', 'b', 'c', 'a'],
      { netUnitCost: '2.00', currency: 'PLN' },
      'u1'
    );

    expect(result).toEqual({ filled: ['a'], skippedAlreadySet: ['b'], notFound: ['c'] });
    const [sql] = ormRepo.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('"netUnitCost" IS NULL');
  });
});

describe('ProductVariantRepository stable variant order (#3588)', () => {
  it('should read a product\'s variants ordered by sku (nulls last) then id', async () => {
    const find = jest.fn().mockResolvedValue([]);
    const repository = new ProductVariantRepository({
      find,
    } as unknown as Repository<ProductVariantOrmEntity>);

    await repository.findByProductId('ol_product_1');

    expect(find).toHaveBeenCalledWith({
      where: { productId: 'ol_product_1' },
      order: { sku: { direction: 'ASC', nulls: 'LAST' }, id: 'ASC' },
    });
  });
});

describe('ProductVariantRepository list ordering (#3588)', () => {
  function build(): { repository: ProductVariantRepository; orders: unknown[][] } {
    const orders: unknown[][] = [];
    const qb: Record<string, jest.Mock> = {};
    for (const m of ['where', 'andWhere', 'innerJoin', 'skip', 'take']) {
      qb[m] = jest.fn().mockReturnValue(qb);
    }
    qb.orderBy = jest.fn((...a: unknown[]) => {
      orders.push(['orderBy', ...a]);
      return qb;
    });
    qb.addOrderBy = jest.fn((...a: unknown[]) => {
      orders.push(['addOrderBy', ...a]);
      return qb;
    });
    qb.getMany = jest.fn().mockResolvedValue([]);
    qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
    const repository = new ProductVariantRepository({
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as Repository<ProductVariantOrmEntity>);
    return { repository, orders };
  }

  const expected = [
    ['orderBy', 'variant.createdAt', 'DESC'],
    ['addOrderBy', 'variant.sku', 'ASC', 'NULLS LAST'],
    ['addOrderBy', 'variant.id', 'ASC'],
  ];

  it('should break createdAt ties by sku then id when listing rows', async () => {
    const { repository, orders } = build();
    await repository.findManyRows({}, { offset: 0, limit: 10 });
    expect(orders).toEqual(expected);
  });

  it('should break createdAt ties by sku then id when listing with a total', async () => {
    const { repository, orders } = build();
    await repository.findMany({}, { offset: 0, limit: 10 });
    expect(orders).toEqual(expected);
  });
});
