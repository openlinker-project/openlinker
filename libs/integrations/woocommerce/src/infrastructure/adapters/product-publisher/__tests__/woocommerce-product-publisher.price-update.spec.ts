/**
 * WooCommerce Product Publisher Adapter — price-only update (#3505, G01-10)
 *
 * A price change must reach WooCommerce as a PUT carrying the price and
 * nothing else: no stock, no `manage_stock`, no name, no description.
 *
 * The command's amounts are GROSS (ADR-077): a store that taxes and enters
 * prices without tax receives the net figure at the target product's own class
 * rate, read from the product.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/product-publisher/__tests__
 */
import {
  ProductPublishRejectedException,
  ProductPublishTargetNotFoundException,
  isShopProductPriceUpdater,
} from '@openlinker/core/listings';
import type { Connection } from '@openlinker/core/identifier-mapping';

import { WooCommerceHttpResponseException } from '../../../http/woocommerce-http-response.exception';
import type { IWooCommerceHttpClient } from '../../../http/woocommerce-http-client.interface';
import type { WooCommerceTaxRate } from '../../product-master/woocommerce-product.types';
import { WooCommerceProductPublisherAdapter } from '../woocommerce-product-publisher.adapter';

const connection = {
  id: 'conn-wc-1',
  platformType: 'woocommerce',
  name: 'Test WC',
  status: 'active',
  config: {},
  credentialsRef: 'cred-1',
  adapterKey: 'woocommerce.restapi.v3',
  enabledCapabilities: ['ProductPublisher'],
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Connection;

interface StoreStub {
  calcTaxes?: 'yes' | 'no';
  pricesIncludeTax?: 'yes' | 'no';
  /** `woocommerce_default_country`; defaults to `'PL'`. */
  country?: string;
  classes?: string[];
  rates?: Record<string, WooCommerceTaxRate[]>;
  /**
   * Answers to the `_fields=tax_class,tax_status` read of the target product
   * or variation, keyed by path; an exception is thrown for that read.
   */
  targets?: Record<
    string,
    { tax_class?: string; tax_status?: string } | WooCommerceHttpResponseException
  >;
}

/** A store that does not calculate taxes: every price is written as it is. */
const TAXES_OFF_STORE: StoreStub = { calcTaxes: 'no' };

/** Taxes on, prices entered WITHOUT tax, standard 23% and reduced 8% for PL. */
const TAX_EXCLUSIVE_STORE: StoreStub = {
  calcTaxes: 'yes',
  pricesIncludeTax: 'no',
  classes: ['reduced-rate'],
  rates: {
    standard: [{ country: 'PL', rate: '23.0000' }],
    'reduced-rate': [{ country: 'PL', rate: '8.0000' }],
  },
};

const TARGET_FIELDS = { _fields: 'tax_class,tax_status' };

function stubStore(http: jest.Mocked<IWooCommerceHttpClient>, store: StoreStub): void {
  http.get.mockImplementation(
    (path: string, params?: Record<string, string | number | boolean>) => {
      if (path === '/wp-json/wc/v3/settings/general') {
        return Promise.resolve([
          { id: 'woocommerce_calc_taxes', value: store.calcTaxes ?? 'yes' },
          { id: 'woocommerce_default_country', value: store.country ?? 'PL' },
        ]);
      }
      if (path === '/wp-json/wc/v3/settings/tax') {
        return Promise.resolve([
          { id: 'woocommerce_prices_include_tax', value: store.pricesIncludeTax ?? 'no' },
        ]);
      }
      if (path === '/wp-json/wc/v3/taxes/classes') {
        return Promise.resolve(
          ['standard', ...(store.classes ?? [])].map((slug) => ({ slug, name: slug })),
        );
      }
      if (path === '/wp-json/wc/v3/taxes') {
        return Promise.resolve(
          params?.page === 1 ? (store.rates?.[String(params?.class)] ?? []) : [],
        );
      }
      const target = store.targets?.[path];
      if (target instanceof WooCommerceHttpResponseException) return Promise.reject(target);
      if (target !== undefined) return Promise.resolve(target);
      return Promise.reject(new Error(`unexpected GET ${path}`));
    },
  );
}

describe('WooCommerceProductPublisherAdapter — updateShopProductPrice', () => {
  let http: jest.Mocked<IWooCommerceHttpClient>;
  let adapter: WooCommerceProductPublisherAdapter;

  beforeEach(() => {
    http = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
    stubStore(http, TAXES_OFF_STORE);
    http.put.mockResolvedValue({ id: 100, status: 'publish' });
    adapter = new WooCommerceProductPublisherAdapter(http, connection);
  });

  it('should be recognised as a ShopProductPriceUpdater', () => {
    expect(isShopProductPriceUpdater(adapter)).toBe(true);
  });

  it('should PUT exactly the regular price to a standalone product', async () => {
    await adapter.updateShopProductPrice({
      externalProductId: '100',
      price: { amount: '399.00', currency: 'PLN' },
    });

    expect(http.put).toHaveBeenCalledTimes(1);
    expect(http.put).toHaveBeenCalledWith('/wp-json/wc/v3/products/100', {
      regular_price: '399.00',
    });
    expect(http.post).not.toHaveBeenCalled();
  });

  it('should PUT to the variation under its parent when a parent is given', async () => {
    await adapter.updateShopProductPrice({
      externalProductId: '201',
      externalParentProductId: '200',
      price: { amount: '49.90', currency: 'PLN' },
    });

    expect(http.put).toHaveBeenCalledWith('/wp-json/wc/v3/products/200/variations/201', {
      regular_price: '49.90',
    });
  });

  it('should add the sale price only when the command carries one', async () => {
    await adapter.updateShopProductPrice({
      externalProductId: '100',
      price: { amount: '399.00', currency: 'PLN' },
      salePrice: { amount: '349.00', currency: 'PLN' },
    });

    expect(http.put).toHaveBeenCalledWith('/wp-json/wc/v3/products/100', {
      regular_price: '399.00',
      sale_price: '349.00',
    });
  });

  it('should report a product gone shop-side as a target-not-found error when WooCommerce answers 404', async () => {
    http.put.mockRejectedValue(
      new WooCommerceHttpResponseException(404, 'not found', 'woocommerce_rest_product_invalid_id'),
    );

    await expect(
      adapter.updateShopProductPrice({
        externalProductId: '100',
        price: { amount: '399.00', currency: 'PLN' },
      }),
    ).rejects.toBeInstanceOf(ProductPublishTargetNotFoundException);
  });

  it('should report a terminal rejection when WooCommerce answers 400', async () => {
    http.put.mockRejectedValue(
      new WooCommerceHttpResponseException(400, 'bad price', 'rest_invalid_param'),
    );

    await expect(
      adapter.updateShopProductPrice({
        externalProductId: '100',
        price: { amount: '399.00', currency: 'PLN' },
      }),
    ).rejects.toBeInstanceOf(ProductPublishRejectedException);
  });

  describe('price basis (ADR-077)', () => {
    it.each<[string, StoreStub]>([
      ['the store enters prices with tax', { ...TAX_EXCLUSIVE_STORE, pricesIncludeTax: 'yes' }],
      ['the store does not calculate taxes', TAXES_OFF_STORE],
    ])('should write the gross amounts exactly as given when %s', async (_label, store) => {
      stubStore(http, store);

      await adapter.updateShopProductPrice({
        externalProductId: '100',
        price: { amount: '399.00', currency: 'PLN' },
        salePrice: { amount: '349.00', currency: 'PLN' },
      });

      expect(http.put).toHaveBeenCalledWith('/wp-json/wc/v3/products/100', {
        regular_price: '399.00',
        sale_price: '349.00',
      });
      expect(http.get).not.toHaveBeenCalledWith('/wp-json/wc/v3/products/100', TARGET_FIELDS);
    });

    it("should write net amounts at the target product's class rate when the store enters prices without tax", async () => {
      stubStore(http, {
        ...TAX_EXCLUSIVE_STORE,
        targets: { '/wp-json/wc/v3/products/100': { tax_class: '', tax_status: 'taxable' } },
      });

      await adapter.updateShopProductPrice({
        externalProductId: '100',
        // 123.00 and 61.50 gross are exactly 100 and 50 net at 23%.
        price: { amount: '123.00', currency: 'PLN' },
        salePrice: { amount: '61.50', currency: 'PLN' },
      });

      expect(http.get).toHaveBeenCalledWith('/wp-json/wc/v3/products/100', TARGET_FIELDS);
      expect(http.put).toHaveBeenCalledWith('/wp-json/wc/v3/products/100', {
        regular_price: '100',
        sale_price: '50',
      });
    });

    it('should keep 6 decimals on a net amount that is not round', async () => {
      stubStore(http, {
        ...TAX_EXCLUSIVE_STORE,
        targets: {
          '/wp-json/wc/v3/products/100': { tax_class: 'reduced-rate', tax_status: 'taxable' },
        },
      });

      await adapter.updateShopProductPrice({
        externalProductId: '100',
        // 19.99 / 1.08 = 18.5092592...
        price: { amount: '19.99', currency: 'PLN' },
      });

      expect(http.put).toHaveBeenCalledWith('/wp-json/wc/v3/products/100', {
        regular_price: '18.509259',
      });
    });

    it("should resolve a variation's parent class through its parent", async () => {
      stubStore(http, {
        ...TAX_EXCLUSIVE_STORE,
        targets: {
          '/wp-json/wc/v3/products/200/variations/201': { tax_class: 'parent' },
          '/wp-json/wc/v3/products/200': { tax_class: 'reduced-rate', tax_status: 'taxable' },
        },
      });

      await adapter.updateShopProductPrice({
        externalProductId: '201',
        externalParentProductId: '200',
        // 49.90 / 1.08 = 46.2037037...
        price: { amount: '49.90', currency: 'PLN' },
      });

      expect(http.get).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products/200/variations/201',
        TARGET_FIELDS,
      );
      expect(http.get).toHaveBeenCalledWith('/wp-json/wc/v3/products/200', TARGET_FIELDS);
      expect(http.put).toHaveBeenCalledWith('/wp-json/wc/v3/products/200/variations/201', {
        regular_price: '46.203704',
      });
    });

    it('should write the gross amount as it is when the target product is not taxed', async () => {
      stubStore(http, {
        ...TAX_EXCLUSIVE_STORE,
        targets: { '/wp-json/wc/v3/products/100': { tax_class: '', tax_status: 'none' } },
      });

      await adapter.updateShopProductPrice({
        externalProductId: '100',
        price: { amount: '399.00', currency: 'PLN' },
      });

      expect(http.put).toHaveBeenCalledWith('/wp-json/wc/v3/products/100', {
        regular_price: '399.00',
      });
      expect(http.get).not.toHaveBeenCalledWith('/wp-json/wc/v3/taxes/classes');
    });

    it('should refuse terminally with TAX_RATE_UNRESOLVED when the target class has no rate for the store country', async () => {
      stubStore(http, {
        ...TAX_EXCLUSIVE_STORE,
        targets: { '/wp-json/wc/v3/products/100': { tax_class: 'luxury', tax_status: 'taxable' } },
      });

      await expect(
        adapter.updateShopProductPrice({
          externalProductId: '100',
          price: { amount: '399.00', currency: 'PLN' },
        }),
      ).rejects.toMatchObject({
        name: 'ProductPublishRejectedException',
        statusCode: 0,
        errors: [expect.objectContaining({ code: 'TAX_RATE_UNRESOLVED' })],
      });
      expect(http.put).not.toHaveBeenCalled();
    });

    it('should propagate a transient error reading the target product so the job retries', async () => {
      const err = new WooCommerceHttpResponseException(503, 'Service unavailable');
      stubStore(http, { ...TAX_EXCLUSIVE_STORE, targets: { '/wp-json/wc/v3/products/100': err } });

      const result = adapter.updateShopProductPrice({
        externalProductId: '100',
        price: { amount: '399.00', currency: 'PLN' },
      });

      await expect(result).rejects.toBe(err);
      expect(http.put).not.toHaveBeenCalled();
    });

    it('should report a vanished target as a target-not-found error when its tax read answers 404', async () => {
      stubStore(http, {
        ...TAX_EXCLUSIVE_STORE,
        targets: {
          '/wp-json/wc/v3/products/100': new WooCommerceHttpResponseException(404, 'not found'),
        },
      });

      await expect(
        adapter.updateShopProductPrice({
          externalProductId: '100',
          price: { amount: '399.00', currency: 'PLN' },
        }),
      ).rejects.toBeInstanceOf(ProductPublishTargetNotFoundException);
      expect(http.put).not.toHaveBeenCalled();
    });
  });
});
