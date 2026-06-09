/**
 * Webhook Auth Service Unit Tests
 *
 * @module apps/api/src/webhooks/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhookAuthService } from './webhook-auth.service';
import type { WebhookSecretProviderPort } from '@openlinker/core/integrations';
import { WEBHOOK_SECRET_PROVIDER_TOKEN } from '@openlinker/core/integrations';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import { CONNECTION_PORT_TOKEN, Connection } from '@openlinker/core/identifier-mapping';
import { WebhookAuthenticationException } from '../errors/webhook-authentication.exception';
import { WebhookReplayException } from '../errors/webhook-replay.exception';

describe('WebhookAuthService', () => {
  let service: WebhookAuthService;
  let secretProvider: jest.Mocked<WebhookSecretProviderPort>;
  let connectionPort: jest.Mocked<ConnectionPort>;

  const mockSecret = 'test-secret-key';
  const mockConnection = new Connection(
    '123e4567-e89b-12d3-a456-426614174000',
    'prestashop',
    'Test Connection',
    'active',
    {},
    'test-ref',
    new Date(),
    new Date(),
    'prestashop.webservice.v1',
    ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager']
  );

  beforeEach(async () => {
    const mockSecretProvider = {
      getSecret: jest.fn(),
    };

    const mockConnectionPort = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookAuthService,
        {
          provide: WEBHOOK_SECRET_PROVIDER_TOKEN,
          useValue: mockSecretProvider,
        },
        {
          provide: CONNECTION_PORT_TOKEN,
          useValue: mockConnectionPort,
        },
        {
          provide: ConfigService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<WebhookAuthService>(WebhookAuthService);
    secretProvider = module.get(WEBHOOK_SECRET_PROVIDER_TOKEN);
    connectionPort = module.get(CONNECTION_PORT_TOKEN);

    // Setup default mocks
    secretProvider.getSecret.mockResolvedValue(mockSecret);
    connectionPort.get.mockResolvedValue(mockConnection);
  });

  describe('assertConnectionUsable', () => {
    it('resolves when the connection is active and the provider matches', async () => {
      await expect(
        service.assertConnectionUsable('prestashop', mockConnection.id),
      ).resolves.toBeUndefined();
      expect(connectionPort.get).toHaveBeenCalledWith(mockConnection.id);
    });

    it('throws when the connection is not active', async () => {
      const disabledConnection = new Connection(
        mockConnection.id,
        mockConnection.platformType,
        mockConnection.name,
        'disabled',
        mockConnection.config,
        mockConnection.credentialsRef,
        mockConnection.createdAt,
        mockConnection.updatedAt,
        mockConnection.adapterKey,
        mockConnection.enabledCapabilities
      );
      connectionPort.get.mockResolvedValue(disabledConnection);

      await expect(
        service.assertConnectionUsable('prestashop', mockConnection.id),
      ).rejects.toThrow(WebhookAuthenticationException);
    });

    it('throws on provider / platformType mismatch', async () => {
      await expect(
        service.assertConnectionUsable('inpost', mockConnection.id),
      ).rejects.toThrow(WebhookAuthenticationException);
    });

    it('propagates when the connection does not exist', async () => {
      connectionPort.get.mockRejectedValue(new Error('Connection not found'));
      await expect(
        service.assertConnectionUsable('prestashop', 'non-existent'),
      ).rejects.toThrow();
    });
  });

  describe('getSecret', () => {
    it('resolves the per-connection secret from the provider', async () => {
      await expect(service.getSecret('prestashop', mockConnection.id)).resolves.toBe(mockSecret);
      expect(secretProvider.getSecret).toHaveBeenCalledWith('prestashop', mockConnection.id);
    });
  });

  describe('validateTimestampMs', () => {
    it('accepts a timestamp within the window', () => {
      expect(() => service.validateTimestampMs(Date.now())).not.toThrow();
    });

    it('rejects a timestamp outside the window', () => {
      expect(() => service.validateTimestampMs(Date.now() - 10 * 60 * 1000)).toThrow(
        WebhookReplayException,
      );
    });

    it('rejects a non-finite or non-positive timestamp', () => {
      expect(() => service.validateTimestampMs(Number.NaN)).toThrow(WebhookReplayException);
      expect(() => service.validateTimestampMs(0)).toThrow(WebhookReplayException);
      expect(() => service.validateTimestampMs(-1)).toThrow(WebhookReplayException);
    });

    it('accepts a custom skew window', () => {
      expect(() => service.validateTimestampMs(Date.now() - 2 * 60 * 1000, 5 * 60 * 1000)).not.toThrow();
    });

    // #711 — the default window tightened from 5 min → 120 s.
    it('rejects a 4-minute-old timestamp under the new 120s default window (#711)', () => {
      expect(() => service.validateTimestampMs(Date.now() - 4 * 60 * 1000)).toThrow(
        WebhookReplayException,
      );
    });

    it('accepts a 60-second-old timestamp within the new default window (#711)', () => {
      expect(() => service.validateTimestampMs(Date.now() - 60 * 1000)).not.toThrow();
    });
  });
});
