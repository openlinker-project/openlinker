/**
 * Unit tests for the PrestaShop tax-rate resolver (#895 / ADR-014).
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { PrestashopTaxRateResolver } from '../prestashop-tax-rate.resolver';
import type { PrestashopCountryResolver } from '../prestashop-country-resolver';
import { createMockHttpClient } from '../../../__tests__/mocks/mock-http-client.factory';

describe('PrestashopTaxRateResolver', () => {
  let httpClient: ReturnType<typeof createMockHttpClient>;
  let countryResolver: jest.Mocked<PrestashopCountryResolver>;
  let resolver: PrestashopTaxRateResolver;

  beforeEach(() => {
    httpClient = createMockHttpClient();
    countryResolver = {
      resolveCountryId: jest.fn(),
    } as unknown as jest.Mocked<PrestashopCountryResolver>;
    resolver = new PrestashopTaxRateResolver(countryResolver);
  });

  it('should return 0 when the product has no tax-rule group', async () => {
    httpClient.getResource.mockResolvedValueOnce({ id_tax_rules_group: '0' });

    const rate = await resolver.resolveProductTaxRate('100', undefined, 'conn-1', httpClient);

    expect(rate).toBe(0);
    expect(httpClient.listResources).not.toHaveBeenCalled();
  });

  it('should resolve the delivery-country rule and return its rate as a fraction', async () => {
    httpClient.getResource
      .mockResolvedValueOnce({ id_tax_rules_group: '2' }) // products/100
      .mockResolvedValueOnce({ rate: '23.000' }); // taxes/7
    countryResolver.resolveCountryId.mockResolvedValueOnce(6); // PL → id 6
    httpClient.listResources.mockResolvedValueOnce([
      { id_tax: '9', id_country: '0', id_state: '0' }, // catch-all
      { id_tax: '7', id_country: '6', id_state: '0' }, // PL
    ]);

    const rate = await resolver.resolveProductTaxRate('100', 'PL', 'conn-1', httpClient);

    expect(rate).toBeCloseTo(0.23, 5);
    expect(httpClient.getResource).toHaveBeenCalledWith('taxes', '7');
  });

  it('should fall back to the catch-all rule when the delivery country does not resolve', async () => {
    httpClient.getResource
      .mockResolvedValueOnce({ id_tax_rules_group: '2' })
      .mockResolvedValueOnce({ rate: '5.000' });
    countryResolver.resolveCountryId.mockRejectedValueOnce(new Error('country not found'));
    httpClient.listResources.mockResolvedValueOnce([
      { id_tax: '9', id_country: '0', id_state: '0' },
      { id_tax: '7', id_country: '6', id_state: '0' },
    ]);

    const rate = await resolver.resolveProductTaxRate('100', 'ZZ', 'conn-1', httpClient);

    expect(rate).toBeCloseTo(0.05, 5);
    expect(httpClient.getResource).toHaveBeenCalledWith('taxes', '9');
  });

  it('should return 0 when the product read fails', async () => {
    httpClient.getResource.mockRejectedValueOnce(new Error('boom'));

    const rate = await resolver.resolveProductTaxRate('100', 'PL', 'conn-1', httpClient);

    expect(rate).toBe(0);
  });

  it('should return 0 when the tax-rule group has no usable rules', async () => {
    httpClient.getResource.mockResolvedValueOnce({ id_tax_rules_group: '2' });
    countryResolver.resolveCountryId.mockResolvedValueOnce(6);
    httpClient.listResources.mockResolvedValueOnce([]);

    const rate = await resolver.resolveProductTaxRate('100', 'PL', 'conn-1', httpClient);

    expect(rate).toBe(0);
  });

  it('should cache the resolved rate per product/country', async () => {
    httpClient.getResource
      .mockResolvedValueOnce({ id_tax_rules_group: '2' })
      .mockResolvedValueOnce({ rate: '23.000' });
    countryResolver.resolveCountryId.mockResolvedValue(6);
    httpClient.listResources.mockResolvedValueOnce([{ id_tax: '7', id_country: '6', id_state: '0' }]);

    await resolver.resolveProductTaxRate('100', 'PL', 'conn-1', httpClient);
    await resolver.resolveProductTaxRate('100', 'PL', 'conn-1', httpClient);

    // products + taxes read once each (second call served from cache).
    expect(httpClient.getResource).toHaveBeenCalledTimes(2);
  });
});
