/**
 * BundleReader on the PrestaShop product master (#3932)
 *
 * The product resource shapes below are the ones `readPackDefinition` already
 * pins from PrestaShop's webservice (`cache_is_pack`, `associations.product_bundle`
 * rows of `{id, id_product_attribute, quantity}`).
 */
import { PrestashopProductMasterAdapter } from '../prestashop-product-master.adapter';
import { createMockHttpClient } from '../../../__tests__/mocks/mock-http-client.factory';
import { createMockIdentifierMapping } from '../../../__tests__/mocks/mock-identifier-mapping.factory';
import { createTestConnection } from '../../../__tests__/fixtures/connection.fixture';
import { PrestashopProductMapper } from '../../mappers/prestashop-product.mapper';
import { PrestashopPackUnreadableException } from '../../../domain/exceptions/prestashop-pack-unreadable.exception';
import { isBundleReader } from '@openlinker/core/products';

describe('PrestashopProductMasterAdapter BundleReader', () => {
  function build(product: Record<string, unknown>): PrestashopProductMasterAdapter {
    const http = createMockHttpClient();
    http.getResource = jest.fn().mockResolvedValue(product);
    return new PrestashopProductMasterAdapter(
      http,
      createMockIdentifierMapping(),
      new PrestashopProductMapper({ storefrontBaseUrl: 'https://shop.test' }),
      createTestConnection()
    );
  }

  it('should be recognised by the isBundleReader guard', () => {
    expect(isBundleReader(build({}))).toBe(true);
  });

  it('should return the components of a pack with combination and simple entries', async () => {
    const adapter = build({
      id: '42',
      cache_is_pack: '1',
      associations: {
        product_bundle: [
          { id: '11', id_product_attribute: '0', quantity: '2' },
          { id: '12', id_product_attribute: '31', quantity: '1' },
        ],
      },
    });

    await expect(adapter.readBundleComposition('42')).resolves.toEqual({
      components: [
        { externalProductId: '11', externalVariantId: 'product:11', quantity: 2 },
        { externalProductId: '12', externalVariantId: '31', quantity: 1 },
      ],
    });
  });

  it('should return null when the product is not a pack', async () => {
    const adapter = build({ id: '7', cache_is_pack: '0' });
    await expect(adapter.readBundleComposition('7')).resolves.toBeNull();
  });

  it('should refuse a pack with an unreadable bundle entry', async () => {
    const adapter = build({
      id: '42',
      cache_is_pack: '1',
      associations: { product_bundle: [{ quantity: '2' }, { id: '12', quantity: '1' }] },
    });
    await expect(adapter.readBundleComposition('42')).rejects.toBeInstanceOf(
      PrestashopPackUnreadableException
    );
  });
});
