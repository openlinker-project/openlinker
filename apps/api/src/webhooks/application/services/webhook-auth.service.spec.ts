/**
 * Webhook Auth Service Unit Tests
 *
 * @module apps/api/src/webhooks/application/services
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhookAuthService } from './webhook-auth.service';
import { WebhookSecretProviderPort, WEBHOOK_SECRET_PROVIDER_TOKEN } from '@openlinker/core/integrations';
import { ConnectionPort, CONNECTION_PORT_TOKEN, Connection } from '@openlinker/core/identifier-mapping';
import { WebhookAuthenticationException } from '../errors/webhook-authentication.exception';
import { WebhookReplayException } from '../errors/webhook-replay.exception';
import * as crypto from 'crypto';

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
    ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager'],
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

  describe('verifySignature', () => {
    it('should verify valid signature', async () => {
      const provider = 'prestashop';
      const connectionId = mockConnection.id;
      const timestamp = Date.now().toString();
      const rawBody = Buffer.from('{"test": "data"}');
      const signedPayload = timestamp + '.' + rawBody.toString();
      const signature = crypto.createHmac('sha256', mockSecret).update(signedPayload).digest('hex');

      const result = await service.verifySignature(
        provider,
        connectionId,
        timestamp,
        rawBody,
        `sha256=${signature}`,
      );

      expect(result).toBe(true);
      expect(connectionPort.get).toHaveBeenCalledWith(connectionId);
      expect(secretProvider.getSecret).toHaveBeenCalledWith(provider, connectionId);
    });

    it('should reject invalid signature', async () => {
      const provider = 'prestashop';
      const connectionId = mockConnection.id;
      const timestamp = Date.now().toString();
      const rawBody = Buffer.from('{"test": "data"}');
      // Use a properly formatted hex string (64 chars) but wrong value
      const invalidSignature = 'sha256=' + '0'.repeat(64);

      const result = await service.verifySignature(
        provider,
        connectionId,
        timestamp,
        rawBody,
        invalidSignature,
      );

      expect(result).toBe(false);
    });

    it('should reject signature with wrong format', async () => {
      const provider = 'prestashop';
      const connectionId = mockConnection.id;
      const timestamp = Date.now().toString();
      const rawBody = Buffer.from('{"test": "data"}');

      await expect(
        service.verifySignature(provider, connectionId, timestamp, rawBody, 'invalid-format'),
      ).rejects.toThrow(WebhookAuthenticationException);
    });

    it('should reject if connection not found', async () => {
      connectionPort.get.mockRejectedValue(new Error('Connection not found'));

      const provider = 'prestashop';
      const connectionId = 'non-existent';
      const timestamp = Date.now().toString();
      const rawBody = Buffer.from('{"test": "data"}');
      const signature = 'sha256=test';

      await expect(
        service.verifySignature(provider, connectionId, timestamp, rawBody, signature),
      ).rejects.toThrow();
    });

    it('should reject if connection is not active', async () => {
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
        mockConnection.enabledCapabilities,
      );
      connectionPort.get.mockResolvedValue(disabledConnection);

      const provider = 'prestashop';
      const connectionId = mockConnection.id;
      const timestamp = Date.now().toString();
      const rawBody = Buffer.from('{"test": "data"}');
      const signature = 'sha256=test';

      await expect(
        service.verifySignature(provider, connectionId, timestamp, rawBody, signature),
      ).rejects.toThrow(WebhookAuthenticationException);
    });
  });

  describe('validateTimestamp', () => {
    it('should accept valid timestamp within window', () => {
      const timestamp = Date.now().toString();
      const result = service.validateTimestamp(timestamp);
      expect(result).toBe(true);
    });

    it('should reject timestamp outside window', () => {
      const oldTimestamp = (Date.now() - 10 * 60 * 1000).toString(); // 10 minutes ago
      expect(() => service.validateTimestamp(oldTimestamp)).toThrow(WebhookReplayException);
    });

    it('should reject invalid timestamp format', () => {
      expect(() => service.validateTimestamp('invalid')).toThrow(WebhookReplayException);
      expect(() => service.validateTimestamp('')).toThrow(WebhookReplayException);
      expect(() => service.validateTimestamp('abc123')).toThrow(WebhookReplayException);
    });

    it('should accept custom skew window', () => {
      const timestamp = (Date.now() - 2 * 60 * 1000).toString(); // 2 minutes ago
      const result = service.validateTimestamp(timestamp, 5 * 60 * 1000); // 5 minute window
      expect(result).toBe(true);
    });
  });
});

