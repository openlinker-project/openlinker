/**
 * PrestaShop OpenLinker Module Client Tests
 *
 * Unit tests for PrestashopOpenLinkerModuleClient — HMAC signing, URL
 * construction, header shape, and error mapping. Mocks `fetch` globally
 * (matches the existing PrestashopWebserviceClient spec pattern in this
 * package) and the WebhookSecretProviderPort.
 *
 * @module libs/integrations/prestashop/src/infrastructure/http/__tests__
 */
import { createHmac } from 'crypto';

import type { WebhookSecretProviderPort } from '@openlinker/core/integrations';

import { PrestashopOpenLinkerModuleClient } from '../prestashop-openlinker-module.client';
import { PrestashopOlModuleException } from '../../../domain/exceptions/prestashop-ol-module.exception';

// Mock fetch globally — matches existing PrestashopWebserviceClient spec.
global.fetch = jest.fn();

describe('PrestashopOpenLinkerModuleClient', () => {
  const connectionId = 'conn-uuid-1';
  const baseUrl = 'https://shop.example.com';
  const secret = 'shared-test-secret';
  const idCart = 42;

  let client: PrestashopOpenLinkerModuleClient;
  let secretProvider: jest.Mocked<WebhookSecretProviderPort>;

  beforeEach(() => {
    secretProvider = {
      getSecret: jest.fn().mockResolvedValue(secret),
      invalidate: jest.fn(),
    };
    client = new PrestashopOpenLinkerModuleClient(connectionId, baseUrl, secretProvider);
    jest.clearAllMocks();
  });

  describe('writeCartShipping', () => {
    it('should POST to the cartshipping module endpoint with the documented body shape', async () => {
      // Arrange
      (global.fetch as jest.Mock).mockResolvedValue({
        status: 200,
        json: jest.fn().mockResolvedValue({ ok: true, id_cart: idCart }),
      });

      // Act
      await client.writeCartShipping({
        idCart,
        amountTaxExcl: 12.2,
        amountTaxIncl: 15.0,
        source: 'allegro:order:abc',
      });

      // Assert
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://shop.example.com/index.php?fc=module&module=openlinker&controller=cartshipping'
      );
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({
        id_cart: idCart,
        amount_tax_excl: 12.2,
        amount_tax_incl: 15.0,
        source: 'allegro:order:abc',
      });
    });

    it('should sign the request with HMAC-SHA256 over timestamp + "." + body', async () => {
      // Arrange
      (global.fetch as jest.Mock).mockResolvedValue({
        status: 200,
        json: jest.fn().mockResolvedValue({ ok: true, id_cart: idCart }),
      });

      // Act
      await client.writeCartShipping({
        idCart,
        amountTaxExcl: 12.2,
        amountTaxIncl: 15.0,
      });

      // Assert — recompute the expected signature from the captured body + timestamp
      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      const timestamp = headers['X-OpenLinker-Timestamp'];
      const body = init.body as string;
      const expectedHex = createHmac('sha256', secret)
        .update(timestamp + '.' + body)
        .digest('hex');
      expect(headers['X-OpenLinker-Signature']).toBe('sha256=' + expectedHex);
      expect(headers['X-OpenLinker-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
      expect(secretProvider.getSecret).toHaveBeenCalledWith('prestashop', connectionId);
    });

    it('should serialize source as null when omitted', async () => {
      // Arrange
      (global.fetch as jest.Mock).mockResolvedValue({
        status: 200,
        json: jest.fn().mockResolvedValue({ ok: true, id_cart: idCart }),
      });

      // Act
      await client.writeCartShipping({ idCart, amountTaxExcl: 1, amountTaxIncl: 1 });

      // Assert
      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(init.body as string) as { source: unknown };
      expect(parsedBody.source).toBeNull();
    });

    it('should throw PrestashopOlModuleException when the module returns 401', async () => {
      // Arrange
      (global.fetch as jest.Mock).mockResolvedValue({
        status: 401,
        json: jest.fn().mockResolvedValue({ ok: false, error: 'invalid-signature' }),
      });

      // Act & Assert
      await expect(
        client.writeCartShipping({ idCart, amountTaxExcl: 1, amountTaxIncl: 1 })
      ).rejects.toMatchObject({
        name: 'PrestashopOlModuleException',
        connectionId,
        idCart,
        status: 401,
        reason: 'invalid-signature',
      });
    });

    it('should throw PrestashopOlModuleException when the module returns 500', async () => {
      // Arrange
      (global.fetch as jest.Mock).mockResolvedValue({
        status: 500,
        json: jest.fn().mockResolvedValue({ ok: false, error: 'persist-failed' }),
      });

      // Act & Assert
      await expect(
        client.writeCartShipping({ idCart, amountTaxExcl: 1, amountTaxIncl: 1 })
      ).rejects.toBeInstanceOf(PrestashopOlModuleException);
    });

    it('should resolve cleanly on 2xx response', async () => {
      // Arrange
      (global.fetch as jest.Mock).mockResolvedValue({
        status: 200,
        json: jest.fn().mockResolvedValue({ ok: true, id_cart: idCart }),
      });

      // Act & Assert — should not throw
      await expect(
        client.writeCartShipping({ idCart, amountTaxExcl: 1, amountTaxIncl: 1 })
      ).resolves.toBeUndefined();
    });

    it('should map a fetch network failure to PrestashopOlModuleException with status=0', async () => {
      // Arrange
      (global.fetch as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:443'));

      // Act & Assert
      await expect(
        client.writeCartShipping({ idCart, amountTaxExcl: 1, amountTaxIncl: 1 })
      ).rejects.toMatchObject({
        name: 'PrestashopOlModuleException',
        connectionId,
        idCart,
        status: 0,
      });
    });

    it('should normalize trailing slash on baseUrl', async () => {
      // Arrange
      const slashClient = new PrestashopOpenLinkerModuleClient(
        connectionId,
        'https://shop.example.com/',
        secretProvider
      );
      (global.fetch as jest.Mock).mockResolvedValue({
        status: 200,
        json: jest.fn().mockResolvedValue({ ok: true, id_cart: idCart }),
      });

      // Act
      await slashClient.writeCartShipping({ idCart, amountTaxExcl: 1, amountTaxIncl: 1 });

      // Assert
      const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://shop.example.com/index.php?fc=module&module=openlinker&controller=cartshipping'
      );
    });
  });
});
