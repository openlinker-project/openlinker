/**
 * WooCommerce Offer Manager Adapter Tests (#1498)
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/offer-manager/__tests__
 */
import { WooCommerceOfferManagerAdapter } from '../woocommerce-offer-manager.adapter';
import { WooCommerceHttpResponseException } from '../../../http/woocommerce-http-response.exception';
import { WooCommerceInvalidIdentifierException } from '../../../../domain/exceptions/woocommerce-invalid-identifier.exception';
import { WooCommerceInvalidArgumentException } from '../../../../domain/exceptions/woocommerce-invalid-argument.exception';
import { WooCommerceUnauthorizedException } from '../../../../domain/exceptions/woocommerce-unauthorized.exception';
import type { IWooCommerceHttpClient } from '../../../http/woocommerce-http-client.interface';
import type { Connection } from '@openlinker/core/identifier-mapping';

const makeConnection = (overrides: Partial<Connection> = {}): Connection =>
  ({
    id: 'conn-wc-1',
    platformType: 'woocommerce',
    name: 'Test WC',
    status: 'active',
    config: { siteUrl: 'https://myshop.example.com' },
    credentialsRef: 'cred-ref-001',
    enabledCapabilities: ['OfferManager'],
    adapterKey: 'woocommerce.restapi.v3',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as unknown as Connection;

describe('WooCommerceOfferManagerAdapter', () => {
  let httpClient: jest.Mocked<IWooCommerceHttpClient>;
  let adapter: WooCommerceOfferManagerAdapter;

  beforeEach(() => {
    httpClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<IWooCommerceHttpClient>;
    adapter = new WooCommerceOfferManagerAdapter(httpClient, makeConnection());
  });

  describe('updateOfferQuantity', () => {
    it('should PUT an absolute stock set with manage_stock re-asserted when given a valid command', async () => {
      httpClient.put.mockResolvedValue({});

      await adapter.updateOfferQuantity({ offerId: '123', quantity: 7 });

      expect(httpClient.put).toHaveBeenCalledTimes(1);
      expect(httpClient.put).toHaveBeenCalledWith('/wp-json/wc/v3/products/123', {
        manage_stock: true,
        stock_quantity: 7,
      });
    });

    it('should write quantity 0 when master stock is exhausted (master is authoritative, including 0)', async () => {
      httpClient.put.mockResolvedValue({});

      await adapter.updateOfferQuantity({ offerId: '55', quantity: 0 });

      expect(httpClient.put).toHaveBeenCalledWith('/wp-json/wc/v3/products/55', {
        manage_stock: true,
        stock_quantity: 0,
      });
    });

    it('should throw before any HTTP call when offerId is not numeric', async () => {
      await expect(
        adapter.updateOfferQuantity({ offerId: '../orders/1', quantity: 5 }),
      ).rejects.toThrow(WooCommerceInvalidIdentifierException);

      expect(httpClient.put).not.toHaveBeenCalled();
    });

    it('should throw before any HTTP call when offerId is zero or negative', async () => {
      await expect(adapter.updateOfferQuantity({ offerId: '0', quantity: 5 })).rejects.toThrow(
        WooCommerceInvalidIdentifierException,
      );
      await expect(adapter.updateOfferQuantity({ offerId: '-4', quantity: 5 })).rejects.toThrow(
        WooCommerceInvalidIdentifierException,
      );

      expect(httpClient.put).not.toHaveBeenCalled();
    });

    it('should throw before any HTTP call when quantity is negative or fractional', async () => {
      await expect(adapter.updateOfferQuantity({ offerId: '123', quantity: -1 })).rejects.toThrow(
        WooCommerceInvalidArgumentException,
      );
      await expect(adapter.updateOfferQuantity({ offerId: '123', quantity: 2.5 })).rejects.toThrow(
        WooCommerceInvalidArgumentException,
      );
      await expect(adapter.updateOfferQuantity({ offerId: '123', quantity: NaN })).rejects.toThrow(
        WooCommerceInvalidArgumentException,
      );

      expect(httpClient.put).not.toHaveBeenCalled();
    });

    it('should resolve without throwing when the product is gone shop-side (404 = stale mapping skip)', async () => {
      httpClient.put.mockRejectedValue(
        new WooCommerceHttpResponseException(404, 'Not found', 'woocommerce_rest_product_invalid_id'),
      );

      await expect(adapter.updateOfferQuantity({ offerId: '999', quantity: 3 })).resolves.toBeUndefined();
    });

    it('should propagate non-404 HTTP response errors so the runner retries them', async () => {
      httpClient.put.mockRejectedValue(new WooCommerceHttpResponseException(500, 'Server error'));

      await expect(adapter.updateOfferQuantity({ offerId: '123', quantity: 3 })).rejects.toThrow(
        WooCommerceHttpResponseException,
      );
    });

    it('should propagate unauthorized errors so the auth-failure classifier sees them', async () => {
      httpClient.put.mockRejectedValue(
        new WooCommerceUnauthorizedException('Invalid consumer key'),
      );

      await expect(adapter.updateOfferQuantity({ offerId: '123', quantity: 3 })).rejects.toThrow(
        WooCommerceUnauthorizedException,
      );
    });
  });
});
