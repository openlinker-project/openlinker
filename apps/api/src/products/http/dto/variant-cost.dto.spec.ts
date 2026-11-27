/**
 * Variant cost DTO validation spec (#3588)
 *
 * Runs class-validator against a plain-to-class instance, the same path Nest's
 * ValidationPipe takes.
 *
 * @module apps/api/src/products/http/dto
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BulkFillVariantCostRequestDto, SetVariantCostRequestDto } from './variant-cost.dto';

async function setErrors(payload: Record<string, unknown>): Promise<number> {
  const errors = await validate(plainToInstance(SetVariantCostRequestDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.length;
}

async function bulkErrors(payload: Record<string, unknown>): Promise<number> {
  const errors = await validate(plainToInstance(BulkFillVariantCostRequestDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.length;
}

describe('SetVariantCostRequestDto', () => {
  it.each([
    ['a normal cost', { netUnitCost: '12.5', currency: 'PLN' }],
    ['0.00', { netUnitCost: '0.00', currency: 'EUR' }],
    ['four decimals', { netUnitCost: '1.2345', currency: 'PLN' }],
    ['a clearing null pair', { netUnitCost: null, currency: null }],
  ])('should accept %s', async (_l, payload) => {
    await expect(setErrors(payload)).resolves.toBe(0);
  });

  it.each([
    ['amount without currency', { netUnitCost: '1.00', currency: null }],
    ['currency without amount', { netUnitCost: null, currency: 'PLN' }],
    ['a missing currency key', { netUnitCost: '1.00' }],
    ['a missing pair', {}],
    ['a negative amount', { netUnitCost: '-1', currency: 'PLN' }],
    ['five decimals', { netUnitCost: '1.23456', currency: 'PLN' }],
    ['nine integer digits', { netUnitCost: '123456789', currency: 'PLN' }],
    ['lower-case currency', { netUnitCost: '1', currency: 'pln' }],
    ['a numeric (non-string) amount', { netUnitCost: 5, currency: 'PLN' }],
  ])('should reject %s', async (_l, payload) => {
    await expect(setErrors(payload)).resolves.toBeGreaterThan(0);
  });
});

describe('BulkFillVariantCostRequestDto', () => {
  const ok = { variantIds: ['ol_variant_1', 'ol_variant_2'], netUnitCost: '0.00', currency: 'PLN' };

  it('should accept 0.00 and a normal id list', async () => {
    await expect(bulkErrors(ok)).resolves.toBe(0);
  });

  it.each([
    ['an empty list', { ...ok, variantIds: [] }],
    ['duplicate ids', { ...ok, variantIds: ['a', 'a'] }],
    ['501 ids', { ...ok, variantIds: Array.from({ length: 501 }, (_, i) => `v${i}`) }],
    ['a null cost (bulk cannot clear)', { ...ok, netUnitCost: null }],
    ['a missing currency', { variantIds: ['a'], netUnitCost: '1.00' }],
  ])('should reject %s', async (_l, payload) => {
    await expect(bulkErrors(payload)).resolves.toBeGreaterThan(0);
  });
});
