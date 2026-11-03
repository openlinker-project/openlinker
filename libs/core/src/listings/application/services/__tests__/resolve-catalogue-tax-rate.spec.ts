/**
 * Resolve Catalogue Tax Rate - shared helper spec (#3737, ADR-077)
 *
 * The offer builder and the product-publish builder both stamp the variant's
 * catalogue rate onto their command through this one helper, so a net-priced
 * shop can turn the gross catalogue price back into its own net field. A read
 * failure degrades to "no rate" and is logged, never thrown.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import type { LoggerPort } from '@openlinker/shared/logging';
import type { IProductsService, StoredTaxRate } from '@openlinker/core/products';

import { resolveCatalogueTaxRate } from '../resolve-catalogue-tax-rate';

describe('resolveCatalogueTaxRate', () => {
  const PRODUCT_ID = 'ol_product_1';
  const VARIANT_ID = 'ol_variant_1';

  let productsService: jest.Mocked<Pick<IProductsService, 'getEffectiveTaxRate'>>;
  let logger: jest.Mocked<LoggerPort>;

  beforeEach(() => {
    productsService = { getEffectiveTaxRate: jest.fn() };
    logger = { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  });

  it('should return the code and country when the catalogue holds a rate', async () => {
    const stored: StoredTaxRate = {
      code: '23',
      countryIso2: 'PL',
      readAt: new Date('2026-10-01T00:00:00Z'),
    };
    productsService.getEffectiveTaxRate.mockResolvedValue(stored);

    const result = await resolveCatalogueTaxRate(productsService, logger, PRODUCT_ID, VARIANT_ID);

    expect(result).toEqual({ code: '23', countryIso2: 'PL' });
    expect(productsService.getEffectiveTaxRate).toHaveBeenCalledWith(PRODUCT_ID, VARIANT_ID);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('should return nulls without warning when the catalogue holds no rate', async () => {
    productsService.getEffectiveTaxRate.mockResolvedValue({
      code: null,
      countryIso2: null,
      readAt: null,
    });

    const result = await resolveCatalogueTaxRate(productsService, logger, PRODUCT_ID, VARIANT_ID);

    expect(result).toEqual({ code: null, countryIso2: null });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('should keep a rate code with no country when the rate was resolved country-less', async () => {
    productsService.getEffectiveTaxRate.mockResolvedValue({
      code: 'zw',
      countryIso2: null,
      readAt: new Date('2026-10-01T00:00:00Z'),
    });

    const result = await resolveCatalogueTaxRate(productsService, logger, PRODUCT_ID, VARIANT_ID);

    expect(result).toEqual({ code: 'zw', countryIso2: null });
  });

  it('should warn and return nulls when the rate read throws', async () => {
    productsService.getEffectiveTaxRate.mockRejectedValue(new Error('db unavailable'));

    const result = await resolveCatalogueTaxRate(productsService, logger, PRODUCT_ID, VARIANT_ID);

    expect(result).toEqual({ code: null, countryIso2: null });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(VARIANT_ID));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('db unavailable'));
  });
});
