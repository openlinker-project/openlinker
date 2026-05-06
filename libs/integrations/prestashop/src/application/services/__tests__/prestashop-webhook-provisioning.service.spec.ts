/**
 * PrestaShop Webhook Provisioning Service — Unit Tests
 *
 * Covers the orchestrator's branches: happy path, missing/invalid callback URL,
 * non-PrestaShop platform, WS push failure, state-update failure, ping failure.
 *
 * Mocks:
 *   - ConnectionPort        — get + update
 *   - WebhookSecretService  — rotate (returns plaintext)
 *   - CredentialsResolver   — get (returns PS credentials)
 *   - global `fetch`        — ping HTTP call
 *   - PrestashopWebserviceClient — listResources / createResource / updateResource
 *
 * The WS client is constructed inside the service (not injected) so we mock
 * the underlying `fetch` for the WS calls too. We work around this by stubbing
 * the constructor via the module path.
 *
 * @module libs/integrations/prestashop/src/application/services/__tests__
 */
import { BadRequestException } from '@nestjs/common';
import { ConnectionPort, Connection } from '@openlinker/core/identifier-mapping';
import {
  IWebhookSecretService,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import { PrestashopWebhookProvisioningService } from '../prestashop-webhook-provisioning.service';
import * as wsClientModule from '../../../infrastructure/http/prestashop-webservice.client';

describe('PrestashopWebhookProvisioningService', () => {
  let service: PrestashopWebhookProvisioningService;
  let connectionPort: jest.Mocked<ConnectionPort>;
  let webhookSecretService: jest.Mocked<IWebhookSecretService>;
  let credentialsResolver: jest.Mocked<CredentialsResolverPort>;
  let mockWsClient: {
    listResources: jest.Mock;
    createResource: jest.Mock;
    updateResource: jest.Mock;
    getResource: jest.Mock;
  };
  let fetchSpy: jest.SpyInstance;

  const baseConnection = new Connection(
    'connection-123',
    'prestashop',
    'Test Shop',
    'active',
    {
      baseUrl: 'https://shop.example.com',
      openlinkerCallbackBaseUrl: 'https://api.openlinker.example',
    },
    'db:cred-ref',
    new Date(),
    new Date(),
    undefined,
    ['ProductMaster'],
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
      get: jest.fn().mockResolvedValue({ webserviceApiKey: 'ws-key' }),
    } as unknown as jest.Mocked<CredentialsResolverPort>;

    mockWsClient = {
      // No existing configuration rows in the happy path → service falls into createResource.
      listResources: jest.fn().mockResolvedValue([]),
      createResource: jest.fn().mockResolvedValue({}),
      updateResource: jest.fn().mockResolvedValue({}),
      getResource: jest.fn(),
    };
    // Stub the WS client constructor — service `new`s it inline.
    jest
      .spyOn(wsClientModule, 'PrestashopWebserviceClient')
      .mockImplementation(() => mockWsClient as never);

    // Default ping success.
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    service = new PrestashopWebhookProvisioningService(
      connectionPort,
      webhookSecretService,
      credentialsResolver,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('happy path', () => {
    it('rotates secret, pushes 3 configurations, marks configured, fires ping', async () => {
      const result = await service.install('connection-123', 'user-1');

      expect(webhookSecretService.rotate).toHaveBeenCalledWith(
        'prestashop',
        'connection-123',
        'user-1',
      );

      // Three upsert attempts (each does a list-by-name → create flow because list returns empty).
      expect(mockWsClient.listResources).toHaveBeenCalledTimes(3);
      expect(mockWsClient.createResource).toHaveBeenCalledTimes(3);

      // PS WS body must be flat (`{ name, value }`) — the WS client adds the
      // `{ prestashop: { configuration: ... } }` wrapper itself. (#541)
      const namesPushed = mockWsClient.createResource.mock.calls.map(
        (call: unknown[]) => {
          const body = call[1] as { name: string };
          return body.name;
        },
      );
      expect(namesPushed).toEqual([
        'OPENLINKER_BASE_URL',
        'OPENLINKER_CONNECTION_ID',
        'OPENLINKER_WEBHOOK_SECRET',
      ]);
      // Defensive: assert the body is flat, not `{ configuration: {...} }`.
      // Catches the #541 double-wrap regression at the unit-test layer.
      const createCalls = mockWsClient.createResource.mock.calls as unknown[][];
      for (const call of createCalls) {
        const body = call[1] as Record<string, unknown>;
        expect(body).not.toHaveProperty('configuration');
        expect(body).toHaveProperty('name');
        expect(body).toHaveProperty('value');
      }

      // Connection.config.webhooksConfigured set true.
      expect(connectionPort.update).toHaveBeenCalledWith(
        'connection-123',
        expect.objectContaining({
          config: expect.objectContaining({ webhooksConfigured: true }),
        }),
      );

      // Ping fired against the PS shop URL with HMAC headers.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [pingUrl, pingInit] = fetchSpy.mock.calls[0];
      expect(pingUrl).toBe('https://shop.example.com/module/openlinker/ping');
      const headers = (pingInit as RequestInit).headers as Record<string, string>;
      expect(headers['X-OpenLinker-Timestamp']).toBeDefined();
      expect(headers['X-OpenLinker-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);

      expect(result).toEqual({
        webhooksConfigured: true,
        testPingTriggered: true,
      });
    });

    it('updates an existing configuration row when listResources returns a hit', async () => {
      mockWsClient.listResources.mockResolvedValueOnce([{ id: 42 }]);
      mockWsClient.listResources.mockResolvedValue([]);

      await service.install('connection-123');

      // PS WS PUT body is flat, with `id` stringified to match the path id.
      // No `configuration:` wrapper — the WS client adds it. (#541)
      expect(mockWsClient.updateResource).toHaveBeenCalledWith(
        'configurations',
        42,
        expect.objectContaining({
          id: '42',
          name: 'OPENLINKER_BASE_URL',
        }),
      );
      const updateCalls = mockWsClient.updateResource.mock.calls as unknown[][];
      const updateBody = updateCalls[0][1] as Record<string, unknown>;
      expect(updateBody).not.toHaveProperty('configuration');
      expect(mockWsClient.createResource).toHaveBeenCalledTimes(2); // remaining two
    });
  });

  describe('input validation', () => {
    it('throws BadRequestException for non-PrestaShop connection', async () => {
      connectionPort.get.mockResolvedValue(
        new Connection(
          'allegro-1',
          'allegro',
          'Allegro',
          'active',
          {},
          'db:cred',
          new Date(),
          new Date(),
          undefined,
          [],
        ),
      );
      await expect(service.install('allegro-1')).rejects.toThrow(BadRequestException);
      expect(webhookSecretService.rotate).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when openlinkerCallbackBaseUrl is unset', async () => {
      connectionPort.get.mockResolvedValue(
        new Connection(
          'connection-123',
          'prestashop',
          'Test',
          'active',
          { baseUrl: 'https://shop.example.com' }, // no openlinkerCallbackBaseUrl
          'db:cred',
          new Date(),
          new Date(),
          undefined,
          [],
        ),
      );
      await expect(service.install('connection-123')).rejects.toThrow(
        /OL callback URL/,
      );
      expect(webhookSecretService.rotate).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when baseUrl is missing from config', async () => {
      connectionPort.get.mockResolvedValue(
        new Connection(
          'connection-123',
          'prestashop',
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
      await expect(service.install('connection-123')).rejects.toThrow(/baseUrl/);
    });
  });

  describe('failure modes', () => {
    it('throws and surfaces partial-state warning when WS push fails', async () => {
      mockWsClient.listResources.mockRejectedValueOnce(new Error('PS WS 401'));

      await expect(service.install('connection-123')).rejects.toThrow(
        /Configuration push to PrestaShop failed/,
      );

      // Secret was rotated — connection.update was NOT called (push failed before).
      expect(webhookSecretService.rotate).toHaveBeenCalled();
      expect(connectionPort.update).not.toHaveBeenCalled();
    });

    it('returns warning=state-update-failed when connection.update fails after push', async () => {
      connectionPort.update.mockRejectedValue(new Error('DB write failed'));

      const result = await service.install('connection-123');

      expect(result.webhooksConfigured).toBe(false);
      expect(result.warning).toBe('state-update-failed');
    });

    it('returns warning=ping-not-received when ping returns non-2xx', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 502 } as Response);

      const result = await service.install('connection-123');

      expect(result.webhooksConfigured).toBe(true);
      expect(result.testPingTriggered).toBe(false);
      expect(result.warning).toBe('ping-not-received');
    });

    it('returns warning=ping-not-received when ping throws', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network unreachable'));

      const result = await service.install('connection-123');

      expect(result.webhooksConfigured).toBe(true);
      expect(result.testPingTriggered).toBe(false);
      expect(result.warning).toBe('ping-not-received');
    });
  });
});
