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
      has: jest.fn().mockResolvedValue(true),
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
        text: jest.fn().mockResolvedValue(JSON.stringify({ ok: true, id_cart: idCart })),
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
        text: jest.fn().mockResolvedValue(JSON.stringify({ ok: true, id_cart: idCart })),
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
        text: jest.fn().mockResolvedValue(JSON.stringify({ ok: true, id_cart: idCart })),
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
        text: jest.fn().mockResolvedValue(JSON.stringify({ ok: false, error: 'invalid-signature' })),
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
        text: jest.fn().mockResolvedValue(JSON.stringify({ ok: false, error: 'persist-failed' })),
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
        text: jest.fn().mockResolvedValue(JSON.stringify({ ok: true, id_cart: idCart })),
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

    it('should reject an HTML body sent with status 200 (#2601)', async () => {
      // Arrange - a PrestaShop front controller that dies early answers the
      // shop error page with status 200, which used to read as a written row.
      (global.fetch as jest.Mock).mockResolvedValue({
        status: 200,
        text: jest.fn().mockResolvedValue('<!DOCTYPE html><html><body>Error</body></html>'),
      });

      // Act & Assert
      await expect(
        client.writeCartShipping({ idCart, amountTaxExcl: 1, amountTaxIncl: 1 })
      ).rejects.toMatchObject({
        name: 'PrestashopOlModuleException',
        status: 200,
        reason: 'non-json-module-response',
      });
    });

    it('should reject a JSON 200 whose envelope reports a failure', async () => {
      // Arrange
      (global.fetch as jest.Mock).mockResolvedValue({
        status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({ ok: false, error: 'persist-failed' })),
      });

      // Act & Assert
      await expect(
        client.writeCartShipping({ idCart, amountTaxExcl: 1, amountTaxIncl: 1 })
      ).rejects.toMatchObject({ status: 200, reason: 'persist-failed' });
    });

    it('should report the status when a non-2xx carries no readable envelope', async () => {
      // Arrange
      (global.fetch as jest.Mock).mockResolvedValue({
        status: 503,
        text: jest.fn().mockResolvedValue('<html>maintenance</html>'),
      });

      // Act & Assert
      await expect(
        client.writeCartShipping({ idCart, amountTaxExcl: 1, amountTaxIncl: 1 })
      ).rejects.toMatchObject({ status: 503, reason: 'http-503' });
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
        text: jest.fn().mockResolvedValue(JSON.stringify({ ok: true, id_cart: idCart })),
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

  describe('importOrder', () => {
    const input = {
      idCart,
      idOrderState: 2,
      amountPaid: 199.99,
      paymentMethod: 'Check payment',
      orderReference: 'OLREF01',
    };

    it('should return the created order on a well-formed envelope', async () => {
      // Arrange
      (global.fetch as jest.Mock).mockResolvedValue({
        status: 200,
        text: jest.fn().mockResolvedValue(
          JSON.stringify({ ok: true, id_order: 77, reference: 'ABCDEFGHI', already_existed: false })
        ),
      });

      // Act
      const result = await client.importOrder(input);

      // Assert
      expect(result).toEqual({ idOrder: 77, reference: 'ABCDEFGHI', alreadyExisted: false });
    });

    it('should reject an HTML body sent with status 200 (#2601)', async () => {
      // Arrange - an inactive payment module made validateOrder die() with HTML.
      (global.fetch as jest.Mock).mockResolvedValue({
        status: 200,
        text: jest.fn().mockResolvedValue('<html><body>This payment method is not available</body></html>'),
      });

      // Act & Assert
      await expect(client.importOrder(input)).rejects.toMatchObject({
        status: 200,
        reason: 'non-json-module-response',
      });
    });

    it('should surface the module error reason from a 422 envelope', async () => {
      // Arrange
      (global.fetch as jest.Mock).mockResolvedValue({
        status: 422,
        text: jest
          .fn()
          .mockResolvedValue(JSON.stringify({ ok: false, error: 'payment-module-inactive' })),
      });

      // Act & Assert
      await expect(client.importOrder(input)).rejects.toMatchObject({
        status: 422,
        reason: 'payment-module-inactive',
      });
    });

    it('should reject a 200 envelope missing the order fields', async () => {
      // Arrange
      (global.fetch as jest.Mock).mockResolvedValue({
        status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({ ok: true })),
      });

      // Act & Assert
      await expect(client.importOrder(input)).rejects.toMatchObject({
        reason: 'malformed-import-order-response',
      });
    });
  });
});
