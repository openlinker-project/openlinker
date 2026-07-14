/**
 * WooCommerce Webhook Provisioning Adapter — Unit Tests (#1548)
 *
 * Covers the orchestrator branches: happy path (create), idempotent upsert
 * (update existing), missing callback URL, missing siteUrl, WC push failure,
 * and state-update failure.
 *
 * The WC HTTP client is constructed inside the adapter (not injected), so the
 * underlying constructor is stubbed via the module path.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/__tests__
 */
import { BadRequestException } from '@nestjs/common';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import { Connection } from '@openlinker/core/identifier-mapping';
import type { IWebhookSecretService, CredentialsResolverPort } from '@openlinker/core/integrations';
import { WooCommerceWebhookProvisioningAdapter } from '../woocommerce-webhook-provisioning.adapter';
import * as httpClientModule from '../../http/woocommerce-http-client';

describe('WooCommerceWebhookProvisioningAdapter', () => {
  let adapter: WooCommerceWebhookProvisioningAdapter;
  let connectionPort: jest.Mocked<ConnectionPort>;
  let webhookSecretService: jest.Mocked<IWebhookSecretService>;
  let credentialsResolver: jest.Mocked<CredentialsResolverPort>;
  let mockHttpClient: {
    get: jest.Mock;
    post: jest.Mock;
    put: jest.Mock;
    delete: jest.Mock;
  };

  const baseConnection = new Connection(
    'connection-123',
    'woocommerce',
    'Test Store',
    'active',
    {
      siteUrl: 'https://store.example.com',
      openlinkerCallbackBaseUrl: 'https://api.openlinker.example',
    },
    'db:cred-ref',
    new Date(),
    new Date(),
    undefined,
    ['OrderSource'],
  );

  beforeEach(() => {
    connectionPort = {
      get: jest.fn().mockResolvedValue(baseConnection),
      update: jest.fn().mockResolvedValue(baseConnection),
      list: jest.fn(),
      create: jest.fn(),
      disable: jest.fn(),
    } as unknown as jest.Mocked<ConnectionPort>;

    webhookSecretService = {
      rotate: jest.fn().mockResolvedValue({ secret: 'rotated-secret-hex' }),
    } as unknown as jest.Mocked<IWebhookSecretService>;

    credentialsResolver = {
      get: jest.fn().mockResolvedValue({ consumerKey: 'ck_x', consumerSecret: 'cs_y' }),
    } as unknown as jest.Mocked<CredentialsResolverPort>;

    mockHttpClient = {
      // No existing webhooks in the happy path -> adapter falls into POST create.
      get: jest.fn().mockResolvedValue([]),
      post: jest.fn().mockResolvedValue({ id: 1 }),
      put: jest.fn().mockResolvedValue({ id: 1 }),
      delete: jest.fn(),
    };
    jest
      .spyOn(httpClientModule, 'WooCommerceHttpClient')
      .mockImplementation(() => mockHttpClient as never);

    adapter = new WooCommerceWebhookProvisioningAdapter(
      connectionPort,
      webhookSecretService,
      credentialsResolver,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('happy path', () => {
    it('rotates secret, creates order webhooks, marks configured', async () => {
      const result = await adapter.install('connection-123', 'user-1');

      expect(webhookSecretService.rotate).toHaveBeenCalledWith(
        'woocommerce',
        'connection-123',
        'user-1',
      );

      // Lists existing once, then POSTs one webhook per order topic.
      expect(mockHttpClient.get).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.post).toHaveBeenCalledTimes(2);

      const topics = mockHttpClient.post.mock.calls.map((c: unknown[]) => {
        const body = c[1] as { topic: string };
        return body.topic;
      });
      expect(topics).toEqual(['order.created', 'order.updated']);

      // Each webhook targets OL's ingress with the rotated secret + active status.
      for (const call of mockHttpClient.post.mock.calls as unknown[][]) {
        const body = call[1] as Record<string, unknown>;
        expect(body.delivery_url).toBe(
          'https://api.openlinker.example/webhooks/woocommerce/connection-123',
        );
        expect(body.secret).toBe('rotated-secret-hex');
        expect(body.status).toBe('active');
      }

      expect(connectionPort.update).toHaveBeenCalledWith(
        'connection-123',
        expect.objectContaining({
          config: expect.objectContaining({ webhooksConfigured: true }),
        }),
      );

      // WooCommerce has no synchronous verifiable ping -> false, no warning.
      expect(result).toEqual({ webhooksConfigured: true, testPingTriggered: false });
    });

    it('updates an existing webhook (matched by topic + delivery_url) instead of duplicating', async () => {
      mockHttpClient.get.mockResolvedValue([
        {
          id: 55,
          topic: 'order.created',
          delivery_url: 'https://api.openlinker.example/webhooks/woocommerce/connection-123',
        },
      ]);

      await adapter.install('connection-123');

      expect(mockHttpClient.put).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.put).toHaveBeenCalledWith(
        '/wp-json/wc/v3/webhooks/55',
        expect.objectContaining({ topic: 'order.created', status: 'active' }),
      );
      // Only the unmatched topic (order.updated) is created.
      expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
      const created = (mockHttpClient.post.mock.calls[0] as unknown[])[1] as { topic: string };
      expect(created.topic).toBe('order.updated');
    });

    it('pages the existing-webhook listing until exhausted so a match past page 1 is not duplicated', async () => {
      const deliveryUrl = 'https://api.openlinker.example/webhooks/woocommerce/connection-123';
      // A full first page (100 unrelated rows) forces a second page fetch; the
      // OL match sits on page 2, so a single-page listing would have missed it.
      const fullFirstPage = Array.from({ length: 100 }, (_, i) => ({
        id: 1000 + i,
        topic: 'product.updated',
        delivery_url: `https://other.example/${i}`,
      }));
      const secondPage = [{ id: 77, topic: 'order.created', delivery_url: deliveryUrl }];
      mockHttpClient.get
        .mockResolvedValueOnce(fullFirstPage)
        .mockResolvedValueOnce(secondPage);

      await adapter.install('connection-123');

      // Two pages read (full page 1 -> keep paging; short page 2 -> stop).
      expect(mockHttpClient.get).toHaveBeenCalledTimes(2);
      expect(mockHttpClient.get).toHaveBeenNthCalledWith(
        1,
        '/wp-json/wc/v3/webhooks',
        expect.objectContaining({ page: 1 }),
      );
      expect(mockHttpClient.get).toHaveBeenNthCalledWith(
        2,
        '/wp-json/wc/v3/webhooks',
        expect.objectContaining({ page: 2 }),
      );
      // The page-2 match is updated (not duplicated); only order.updated is POSTed.
      expect(mockHttpClient.put).toHaveBeenCalledWith(
        '/wp-json/wc/v3/webhooks/77',
        expect.objectContaining({ topic: 'order.created' }),
      );
      expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('input validation', () => {
    it('throws BadRequestException when openlinkerCallbackBaseUrl is unset', async () => {
      connectionPort.get.mockResolvedValue(
        new Connection(
          'connection-123',
          'woocommerce',
          'Test',
          'active',
          { siteUrl: 'https://store.example.com' },
          'db:cred',
          new Date(),
          new Date(),
          undefined,
          [],
        ),
      );

      await expect(adapter.install('connection-123')).rejects.toThrow(BadRequestException);
      await expect(adapter.install('connection-123')).rejects.toThrow(/OL callback URL/);
      expect(webhookSecretService.rotate).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when siteUrl is missing from config', async () => {
      connectionPort.get.mockResolvedValue(
        new Connection(
          'connection-123',
          'woocommerce',
          'Test',
          'active',
          { openlinkerCallbackBaseUrl: 'https://api.openlinker.example' },
          'db:cred',
          new Date(),
          new Date(),
          undefined,
          [],
        ),
      );

      await expect(adapter.install('connection-123')).rejects.toThrow(/siteUrl/);
    });
  });

  describe('failure modes', () => {
    it('throws and fail-closed resets webhooksConfigured to false when the WC push fails', async () => {
      mockHttpClient.get.mockRejectedValue(new Error('WC 401'));

      await expect(adapter.install('connection-123')).rejects.toThrow(
        /WooCommerce webhook registration failed/,
      );

      // Secret was rotated; the persisted flag is fail-closed reset to false so a
      // prior `true` doesn't go stale (mirrors the Erli adapter).
      expect(webhookSecretService.rotate).toHaveBeenCalled();
      expect(connectionPort.update).toHaveBeenCalledWith(
        'connection-123',
        expect.objectContaining({
          config: expect.objectContaining({ webhooksConfigured: false }),
        }),
      );
    });

    it('returns warning=state-update-failed when connection.update fails after push', async () => {
      connectionPort.update.mockRejectedValue(new Error('DB write failed'));

      const result = await adapter.install('connection-123');

      expect(result.webhooksConfigured).toBe(false);
      expect(result.testPingTriggered).toBe(false);
      expect(result.warning).toBe('state-update-failed');
    });
  });
});
