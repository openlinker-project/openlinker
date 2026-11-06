/**
 * Unit tests for ShopifyController: the OAuth install of the Shopify app
 * (#3974). The neutral OAuth service is mocked; the Shopify callback check
 * (hmac + shop) is exercised for real.
 */
import { createHmac } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Connection } from '@openlinker/core/identifier-mapping';

import {
  OAUTH_CONNECTION_SERVICE_TOKEN,
  type IOAuthConnectionService,
  type OAuthStateData,
} from '../application/interfaces/oauth-connection.service.interface';
import { ShopifyController } from './shopify.controller';

const SECRET = 'app-secret';
const STORE = 'my-shop.myshopify.com';

function signedQuery(params: Record<string, string>, secret = SECRET): string {
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const hmac = createHmac('sha256', secret).update(message).digest('hex');
  return `?${new URLSearchParams({ ...params, hmac }).toString()}`;
}

const STATE_DATA: OAuthStateData = {
  adapterKey: 'shopify.admin.v1',
  platformType: 'shopify',
  clientId: 'id',
  clientSecret: SECRET,
  redirectUri: 'https://ol.example.com/integrations/shopify/connect/callback',
  connectionName: 'Shopify my-shop',
  initialConfig: { storeDomain: STORE },
};

describe('ShopifyController', () => {
  let controller: ShopifyController;
  let oauth: jest.Mocked<IOAuthConnectionService>;

  beforeEach(async () => {
    oauth = {
      generateAuthorizationUrl: jest.fn().mockResolvedValue({ authorizationUrl: 'https://x', state: 'st' }),
      validateState: jest.fn().mockResolvedValue(STATE_DATA),
      completeAuthorization: jest
        .fn()
        .mockResolvedValue({ id: 'conn-1', name: 'Shopify my-shop' } as unknown as Connection),
      markStateCompleted: jest.fn().mockResolvedValue(undefined),
      checkCompletedState: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<IOAuthConnectionService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShopifyController],
      providers: [{ provide: OAUTH_CONNECTION_SERVICE_TOKEN, useValue: oauth }],
    }).compile();
    controller = module.get(ShopifyController);
  });

  describe('connect', () => {
    it('should start the install with the normalised store as the config seed', async () => {
      await controller.connect({
        storeDomain: 'https://My-Shop.myshopify.com/',
        clientId: 'id',
        clientSecret: SECRET,
        redirectUri: STATE_DATA.redirectUri,
        locationId: '123',
      });

      expect(oauth.generateAuthorizationUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          adapterKey: 'shopify.admin.v1',
          platformType: 'shopify',
          connectionName: `Shopify ${STORE}`,
          initialConfig: { storeDomain: STORE, locationId: '123' },
        }),
      );
    });

    it('should refuse a store that is not a *.myshopify.com domain before redirecting', async () => {
      await expect(
        controller.connect({
          storeDomain: 'shop.example.com',
          clientId: 'id',
          clientSecret: SECRET,
          redirectUri: STATE_DATA.redirectUri,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(oauth.generateAuthorizationUrl).not.toHaveBeenCalled();
    });
  });

  describe('callback', () => {
    const params = { code: 'c0de', shop: STORE, state: 'st', timestamp: '1700000000' };

    it('should exchange the code once the hmac and shop check out', async () => {
      await expect(controller.callback({ rawQuery: signedQuery(params) })).resolves.toEqual({
        message: 'Shopify store connected.',
        connectionId: 'conn-1',
        connectionName: 'Shopify my-shop',
      });
      expect(oauth.completeAuthorization).toHaveBeenCalledWith('c0de', STATE_DATA);
      expect(oauth.markStateCompleted).toHaveBeenCalledWith('st', 'conn-1', 'Shopify my-shop');
    });

    it('should refuse a forged redirect without exchanging the code', async () => {
      const error = await controller
        .callback({ rawQuery: signedQuery(params, 'forged') })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'SHOPIFY_OAUTH_BAD_HMAC' });
      expect(oauth.completeAuthorization).not.toHaveBeenCalled();
    });

    it('should refuse a redirect for another store than the install', async () => {
      const error = await controller
        .callback({ rawQuery: signedQuery({ ...params, shop: 'other.myshopify.com' }) })
        .catch((e: unknown) => e);

      expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'SHOPIFY_OAUTH_SHOP_MISMATCH' });
      expect(oauth.completeAuthorization).not.toHaveBeenCalled();
    });

    it('should answer a replayed callback from the completed marker', async () => {
      oauth.validateState.mockResolvedValue(null);
      oauth.checkCompletedState.mockResolvedValue({ connectionId: 'conn-1', connectionName: 'S' });

      await expect(controller.callback({ rawQuery: signedQuery(params) })).resolves.toMatchObject({
        connectionId: 'conn-1',
      });
      expect(oauth.completeAuthorization).not.toHaveBeenCalled();
    });

    it('should refuse a state that belongs to another platform', async () => {
      oauth.validateState.mockResolvedValue({ ...STATE_DATA, adapterKey: 'allegro.publicapi.v1' });

      await expect(controller.callback({ rawQuery: signedQuery(params) })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
