/**
 * Unit tests for PrestashopCurrencyResolver (#2139)
 *
 * The resolver had no spec at all while every failure branch returned a
 * hardcoded id `1`, so the guessing was never codified as intended anywhere.
 * These tests pin the opposite contract: resolve, cache, or refuse - and refuse
 * with the class that carries the right retry decision.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { PrestashopCurrencyResolver } from '../prestashop-currency-resolver';
import { PrestashopCurrencyUnknownException } from '../../../domain/exceptions/prestashop-currency-unknown.exception';
import { PrestashopApiException } from '../../../domain/exceptions/prestashop-api.exception';
import { PrestashopRetryClassifierAdapter } from '../../adapters/prestashop-retry-classifier.adapter';
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';

describe('PrestashopCurrencyResolver', () => {
  let resolver: PrestashopCurrencyResolver;
  let client: jest.Mocked<IPrestashopWebserviceClient>;

  beforeEach(() => {
    resolver = new PrestashopCurrencyResolver();
    client = {
      getResource: jest.fn(),
      listResources: jest.fn().mockResolvedValue([{ id: '3', iso_code: 'PLN' }]),
      createResource: jest.fn(),
      updateResource: jest.fn(),
      deleteResource: jest.fn(),
      uploadImage: jest.fn(),
    } as unknown as jest.Mocked<IPrestashopWebserviceClient>;
  });

  describe('resolution', () => {
    it('should resolve an ISO code to the shop currency id', async () => {
      const id = await resolver.resolveCurrencyId('PLN', 'conn-1', client);

      expect(id).toBe(3);
      expect(client.listResources).toHaveBeenCalledWith(
        'currencies',
        { custom: { iso_code: 'PLN' } },
        1,
        0
      );
    });

    it('should normalise the ISO code before querying', async () => {
      await resolver.resolveCurrencyId('  pln  ', 'conn-1', client);

      expect(client.listResources).toHaveBeenCalledWith(
        'currencies',
        { custom: { iso_code: 'PLN' } },
        1,
        0
      );
    });
  });

  describe('caching', () => {
    it('should cache a resolved id per connection - a second call makes no WS request', async () => {
      await resolver.resolveCurrencyId('PLN', 'conn-1', client);
      const second = await resolver.resolveCurrencyId('PLN', 'conn-1', client);

      expect(second).toBe(3);
      expect(client.listResources).toHaveBeenCalledTimes(1);
    });

    it('should fetch independently for different connections', async () => {
      await resolver.resolveCurrencyId('PLN', 'conn-1', client);
      await resolver.resolveCurrencyId('PLN', 'conn-2', client);

      expect(client.listResources).toHaveBeenCalledTimes(2);
    });

    it('should refetch after the cache is cleared for the connection', async () => {
      await resolver.resolveCurrencyId('PLN', 'conn-1', client);
      resolver.clearCache('conn-1');
      await resolver.resolveCurrencyId('PLN', 'conn-1', client);

      expect(client.listResources).toHaveBeenCalledTimes(2);
    });

    it('should refetch after the full cache is cleared', async () => {
      await resolver.resolveCurrencyId('PLN', 'conn-1', client);
      resolver.clearCache();
      await resolver.resolveCurrencyId('PLN', 'conn-1', client);

      expect(client.listResources).toHaveBeenCalledTimes(2);
    });

    it('should re-read once the 24h TTL has elapsed', async () => {
      await resolver.resolveCurrencyId('PLN', 'conn-1', client);

      const past = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(past + 25 * 60 * 60 * 1000);
      try {
        expect(await resolver.resolveCurrencyId('PLN', 'conn-1', client)).toBe(3);
      } finally {
        (Date.now as jest.Mock).mockRestore();
      }

      expect(client.listResources).toHaveBeenCalledTimes(2);
    });

    it('should NOT cache a refusal - the next attempt sees a currency the operator just added', async () => {
      client.listResources.mockResolvedValueOnce([]);

      await expect(resolver.resolveCurrencyId('EUR', 'conn-1', client)).rejects.toBeInstanceOf(
        PrestashopCurrencyUnknownException
      );

      client.listResources.mockResolvedValueOnce([{ id: '4', iso_code: 'EUR' }]);
      expect(await resolver.resolveCurrencyId('EUR', 'conn-1', client)).toBe(4);
    });
  });

  describe('refusal (shop-configuration gap)', () => {
    it('should refuse an ISO the shop has no currency for, instead of returning id 1', async () => {
      client.listResources.mockResolvedValue([]);

      await expect(resolver.resolveCurrencyId('EUR', 'conn-1', client)).rejects.toThrow(
        PrestashopCurrencyUnknownException
      );
    });

    it('should refuse when the WS reports no rows at all (null response)', async () => {
      client.listResources.mockResolvedValue(null as unknown as Array<Record<string, unknown>>);

      await expect(resolver.resolveCurrencyId('EUR', 'conn-1', client)).rejects.toThrow(
        PrestashopCurrencyUnknownException
      );
    });

    it('should refuse an unparseable currency id, instead of returning id 1', async () => {
      client.listResources.mockResolvedValue([{ id: 'not-a-number', iso_code: 'EUR' }]);

      await expect(resolver.resolveCurrencyId('EUR', 'conn-1', client)).rejects.toThrow(
        PrestashopCurrencyUnknownException
      );
    });

    it('should refuse an empty ISO code without querying the shop', async () => {
      await expect(resolver.resolveCurrencyId('   ', 'conn-1', client)).rejects.toThrow(
        PrestashopCurrencyUnknownException
      );
      expect(client.listResources).not.toHaveBeenCalled();
    });

    it('should carry the ISO code, the connection and an operator-actionable message', async () => {
      client.listResources.mockResolvedValue([]);

      await expect(resolver.resolveCurrencyId('eur', 'conn-1', client)).rejects.toMatchObject({
        name: 'PrestashopCurrencyUnknownException',
        isoCode: 'EUR',
        connectionId: 'conn-1',
        // Leads with the identity - the message is rendered verbatim in
        // operator-facing surfaces that clip it hard.
        message: expect.stringMatching(/^Currency EUR unknown in PrestaShop/),
      });
    });
  });

  describe('failed read (transport)', () => {
    it('should propagate the read failure as the retryable PrestashopApiException', async () => {
      client.listResources.mockRejectedValue(new PrestashopApiException('gateway timeout', 504));

      await expect(resolver.resolveCurrencyId('PLN', 'conn-1', client)).rejects.toThrow(
        PrestashopApiException
      );
    });

    it('should NOT conflate a failed read with an unresolvable currency', async () => {
      const classifier = new PrestashopRetryClassifierAdapter();

      client.listResources.mockRejectedValue(new PrestashopApiException('gateway timeout', 504));
      const transport = await resolver
        .resolveCurrencyId('PLN', 'conn-1', client)
        .catch((error: unknown) => error);

      client.listResources.mockReset();
      client.listResources.mockResolvedValue([]);
      const configuration = await resolver
        .resolveCurrencyId('PLN', 'conn-1', client)
        .catch((error: unknown) => error);

      // Different classes, and therefore opposite retry decisions: a 504 keeps
      // its retries, a shop-configuration gap does not.
      expect(transport).toBeInstanceOf(PrestashopApiException);
      expect(transport).not.toBeInstanceOf(PrestashopCurrencyUnknownException);
      expect(configuration).toBeInstanceOf(PrestashopCurrencyUnknownException);
      expect(configuration).not.toBeInstanceOf(PrestashopApiException);
      expect(classifier.isNonRetryable(transport)).toBe(false);
      expect(classifier.isNonRetryable(configuration)).toBe(true);
    });

    it('should propagate a non-PrestaShop read failure unchanged (default-retryable)', async () => {
      client.listResources.mockRejectedValue(new Error('socket hang up'));

      await expect(resolver.resolveCurrencyId('PLN', 'conn-1', client)).rejects.toThrow(
        'socket hang up'
      );
    });
  });
});
