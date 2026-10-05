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
