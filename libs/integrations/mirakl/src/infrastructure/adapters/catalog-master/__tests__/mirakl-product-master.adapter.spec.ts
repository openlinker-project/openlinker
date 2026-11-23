/**
 * Mirakl Product Master Adapter: unit tests (#4284)
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters/catalog-master
 */
import { MasterProductNotFoundError } from '@openlinker/core/products';
import { MiraklConfigException } from '../../../../domain/exceptions/mirakl-config.exception';
import { MiraklNotSupportedException } from '../../../../domain/exceptions/mirakl-not-supported.exception';
import type { MiraklOffer } from '../../../../domain/types/mirakl-offer.types';
import { MiraklOfferReader } from '../mirakl-offer-reader';
import { MiraklProductMasterAdapter } from '../mirakl-product-master.adapter';
import { CONNECTION_ID, fakeIdentity, fakeOffers } from './mirakl-master.fixture';

function setup(
  offers: MiraklOffer[] = [
    {
      shop_sku: 'A',
      product_title: 'Alpha',
      price: 10,
      category_code: 'C1',
      category_label: 'Cat',
    },
    { shop_sku: 'AB', product_title: 'Near miss', price: 20 },
    { product_title: 'No sku' },
    { shop_sku: 'B', product_title: 'Beta', price: 30 },
  ]
): { adapter: MiraklProductMasterAdapter; http: ReturnType<typeof fakeOffers> } {
  const http = fakeOffers(offers);
  const { identity } = fakeIdentity();
  const adapter = new MiraklProductMasterAdapter(
    CONNECTION_ID,
    'Empik',
    new MiraklOfferReader(http.client),
    identity
  );
  return { adapter, http };
}

describe('MiraklProductMasterAdapter', () => {
  it('should read a product by its exact shop_sku and keep the internal id', async () => {
    const { adapter, http } = setup();

    const product = await adapter.getProduct('ol_product_A');

    expect(http.get).toHaveBeenCalledWith('/api/offers', { queryParams: { sku: 'A' } });
    expect(product).toMatchObject({ id: 'ol_product_A', name: 'Alpha', sku: 'A', price: 10 });
  });

  it('should read one offer once for product, variants and categories', async () => {
    const { adapter, http } = setup();

    await adapter.getProduct('ol_product_A');
    const variants = await adapter.getProductVariants('ol_product_A');
    const categories = await adapter.getProductCategories('ol_product_A');

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(variants).toEqual([
      expect.objectContaining({ id: 'ol_productvariant_A', productId: 'ol_product_A', sku: 'A' }),
    ]);
    expect(categories).toEqual([{ id: 'C1', name: 'Cat' }]);
  });

  it('should report an offer Mirakl no longer has as deleted at the master', async () => {
    const { adapter } = setup([{ shop_sku: 'AB' }]);

    await expect(adapter.getProduct('ol_product_A')).rejects.toBeInstanceOf(
      MasterProductNotFoundError
    );
    await expect(adapter.getProductVariants('ol_product_A')).rejects.toBeInstanceOf(
      MasterProductNotFoundError
    );
  });

  it('should treat a missing mapping as a gap, not a deletion', async () => {
    const { adapter } = setup();

    await expect(adapter.getProduct('ol_variant_zzz')).rejects.toBeInstanceOf(
      MiraklConfigException
    );
  });

  it('should read products by external id, skipping the ones Mirakl does not have', async () => {
    const { adapter } = setup();

    const products = await adapter.getProducts({ externalIds: ['B', 'missing', 'B'] });

    expect(products.map((product) => product.id)).toEqual(['ol_product_B']);
  });

  it('should list external ids page by page and skip offers without a sku', async () => {
    const { adapter, http } = setup();

    await expect(adapter.listExternalIds({ offset: 0, limit: 10 })).resolves.toEqual([
      'A',
      'AB',
      'B',
    ]);
    await expect(adapter.listExternalIds({ offset: 1, limit: 2 })).resolves.toEqual(['AB']);
    expect(http.get).toHaveBeenLastCalledWith('/api/offers', {
      queryParams: { max: 2, offset: 1 },
    });
  });

  it('should list a window of products', async () => {
    const { adapter } = setup();

    const products = await adapter.getProducts({ offset: 0, limit: 2 });

    expect(products.map((product) => product.sku)).toEqual(['A', 'AB']);
  });

  it('should refuse filters OF21 cannot answer instead of answering from one window', async () => {
    const { adapter } = setup();

    await expect(adapter.searchProducts('alpha')).rejects.toBeInstanceOf(
      MiraklNotSupportedException
    );
    await expect(adapter.getProducts({ categoryIds: ['C1'] })).rejects.toBeInstanceOf(
      MiraklNotSupportedException
    );
  });

  it('should refuse every catalogue write', async () => {
    const { adapter } = setup();

    await expect(adapter.createProduct({} as never)).rejects.toBeInstanceOf(
      MiraklNotSupportedException
    );
    await expect(adapter.updateProduct('ol_product_A', {} as never)).rejects.toBeInstanceOf(
      MiraklNotSupportedException
    );
    await expect(adapter.deleteProduct('ol_product_A')).rejects.toBeInstanceOf(
      MiraklNotSupportedException
    );
    await expect(adapter.upsertProductVariant('ol_product_A', {} as never)).rejects.toBeInstanceOf(
      MiraklNotSupportedException
    );
    await expect(adapter.assignCategories('ol_product_A', ['C1'])).rejects.toBeInstanceOf(
      MiraklNotSupportedException
    );
  });
});
