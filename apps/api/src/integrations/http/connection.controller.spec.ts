/**
 * Connection Controller Unit Tests
 *
 * Unit tests for ConnectionController, verifying HTTP endpoint
 * handling, request validation, and response formatting.
 *
 * @module apps/api/src/integrations/http
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConnectionController } from './connection.controller';
import { ConnectionService } from '../application/services/connection.service';
import { Connection } from '@openlinker/core/identifier-mapping';
import { ConnectionResponseDto } from './dto/connection-response.dto';
import { ConnectionDiagnosticsResponseDto } from './dto/connection-diagnostics-response.dto';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  WEBHOOK_SECRET_SERVICE_TOKEN,
  CallerSuppliedWebhookSecretNotSupportedException,
} from '@openlinker/core/integrations';
import { WEBHOOK_STATUS_SERVICE_TOKEN } from '../application/interfaces/webhook-status.service.interface';
import { RATE_LIMIT_STATUS_SERVICE_TOKEN } from '../application/interfaces/rate-limit-status.service.interface';
import type { AuthenticatedUser } from '../../auth/auth.types';
import {
  DEMO_MODE_SERVICE_TOKEN,
  type IDemoModeService,
} from '../../auth/demo-mode.service.interface';
import {
  CONNECTION_DIAGNOSTICS_SERVICE_TOKEN,
  type IConnectionDiagnosticsService,
} from '../application/interfaces/connection-diagnostics.service.interface';
import type { ConnectionDiagnosticsReads } from '../application/types/connection-diagnostics.types';

describe('ConnectionController', () => {
  let controller: ConnectionController;
  let service: jest.Mocked<ConnectionService>;
  let demoModeService: jest.Mocked<IDemoModeService>;
  let webhookSecretService: { rotate: jest.Mock; set: jest.Mock };
  let webhookStatusService: { getStatus: jest.Mock };
  let rateLimitStatusService: { getStatus: jest.Mock };
  let integrationsService: { resolveAdapterMetadata: jest.Mock };
  let connectionDiagnosticsService: jest.Mocked<IConnectionDiagnosticsService>;

  const mockConnection = new Connection(
    'connection-123',
    'prestashop',
    'Test Connection',
    'active',
    { baseUrl: 'https://example.com' },
    'cred_123',
    new Date('2025-01-01'),
    new Date('2025-01-01'),

    undefined,
    ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager']
  );

  const mockAdminUser: AuthenticatedUser = { id: 'user-1', username: 'admin', role: 'admin' };

  const diagnosticsReads = (
    overrides: Partial<ConnectionDiagnosticsReads> = {}
  ): ConnectionDiagnosticsReads => ({
    connection: mockConnection,
    recentJobs: [],
    recentFiscalRegistrations: [],
    recentInvoices: [],
    unreadableSources: [],
    ...overrides,
  });

  beforeEach(async () => {
    const mockService = {
      create: jest.fn(),
      list: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      updateCredentials: jest.fn(),
      testConnection: jest.fn(),
      installWebhooks: jest.fn().mockResolvedValue({
        webhooksConfigured: true,
        testPingTriggered: true,
      }),
      disable: jest.fn(),
    } as unknown as jest.Mocked<ConnectionService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectionController],
      providers: [
        {
          provide: ConnectionService,
          useValue: mockService,
        },
        {
          provide: INTEGRATIONS_SERVICE_TOKEN,
          useValue: {
            resolveAdapterMetadata: jest.fn().mockResolvedValue({
              adapterKey: 'prestashop.webservice.v1',
              platformType: 'prestashop',
              supportedCapabilities: ['ProductMaster'],
            }),
          },
        },
        {
          provide: WEBHOOK_SECRET_SERVICE_TOKEN,
          useValue: {
            rotate: jest.fn().mockResolvedValue({ secret: 'deadbeef' }),
            set: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: WEBHOOK_STATUS_SERVICE_TOKEN,
          useValue: {
            getStatus: jest.fn().mockResolvedValue({
              activation: 'verified',
              signature: 'configured',
              lastDeliveryAt: '2026-07-22T09:14:02.000Z',
              lastDeliveryEvent: 'send_to_ksef_success',
              lastDeliveryResult: 'published',
            }),
          },
        },
        {
          provide: RATE_LIMIT_STATUS_SERVICE_TOKEN,
          useValue: {
            getStatus: jest.fn().mockResolvedValue({ enabled: false }),
          },
        },
        {
          provide: DEMO_MODE_SERVICE_TOKEN,
          useValue: { isDemoModeEnabled: jest.fn().mockReturnValue(false) },
        },
        {
          // One composed read, mocked whole (#3179): the three-source fan-out
          // and its degradation policy are the service's own behaviour and are
          // tested in connection-diagnostics.service.spec.ts.
          provide: CONNECTION_DIAGNOSTICS_SERVICE_TOKEN,
          useValue: { getDiagnostics: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<ConnectionController>(ConnectionController);
    service = module.get(ConnectionService);
    demoModeService = module.get(DEMO_MODE_SERVICE_TOKEN);
    webhookSecretService = module.get(WEBHOOK_SECRET_SERVICE_TOKEN);
    webhookStatusService = module.get(WEBHOOK_STATUS_SERVICE_TOKEN);
    rateLimitStatusService = module.get(RATE_LIMIT_STATUS_SERVICE_TOKEN);
    integrationsService = module.get(INTEGRATIONS_SERVICE_TOKEN);
    connectionDiagnosticsService = module.get(CONNECTION_DIAGNOSTICS_SERVICE_TOKEN);
  });

  describe('setWebhookSecret', () => {
    it('resolves the connection and forwards the pasted secret to the service', async () => {
      service.get.mockResolvedValue(mockConnection);

      await controller.setWebhookSecret('connection-123', { secret: 'pasted-secret' }, mockAdminUser);

      expect(webhookSecretService.set).toHaveBeenCalledWith(
        'prestashop',
        'connection-123',
        'pasted-secret',
        'user-1'
      );
    });

    it('maps CallerSuppliedWebhookSecretNotSupportedException to BadRequestException (#1770 review)', async () => {
      service.get.mockResolvedValue(mockConnection);
      webhookSecretService.set.mockRejectedValue(
        new CallerSuppliedWebhookSecretNotSupportedException('prestashop')
      );

      await expect(
        controller.setWebhookSecret('connection-123', { secret: 'pasted-secret' }, mockAdminUser)
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getWebhookStatus', () => {
    it('returns the derived webhook status', async () => {
      const result = await controller.getWebhookStatus('connection-123');

      expect(webhookStatusService.getStatus).toHaveBeenCalledWith('connection-123');
      expect(result.activation).toBe('verified');
      expect(result.signature).toBe('configured');
      expect(result.lastDeliveryEvent).toBe('send_to_ksef_success');
    });
  });

  describe('getRateLimitStatus', () => {
    it('returns the effective rate-limit status', async () => {
      rateLimitStatusService.getStatus.mockResolvedValue({
        enabled: true,
        requestsPerMinute: 60,
        maxConcurrent: 4,
        inFlight: 1,
        queued: 0,
        lastAcquiredAt: new Date('2026-07-31T10:00:00.000Z'),
      });

      const result = await controller.getRateLimitStatus('connection-123');

      expect(rateLimitStatusService.getStatus).toHaveBeenCalledWith('connection-123');
      expect(result.enabled).toBe(true);
      expect(result.requestsPerMinute).toBe(60);
      expect(result.maxConcurrent).toBe(4);
      expect(result.lastAcquiredAt).toBe('2026-07-31T10:00:00.000Z');
    });

    it('reports disabled when no cap is in effect', async () => {
      rateLimitStatusService.getStatus.mockResolvedValue({ enabled: false });

      const result = await controller.getRateLimitStatus('connection-123');

      expect(result.enabled).toBe(false);
      expect(result.requestsPerMinute).toBeUndefined();
    });
  });

  describe('create', () => {
    it('should create connection and return DTO', async () => {
      service.create.mockResolvedValue(mockConnection);

      const dto = {
        name: 'Test Connection',
        platformType: 'prestashop',
        config: { baseUrl: 'https://example.com' },
        credentialsRef: 'db:cred_123',
      };

      const result = await controller.create(dto, mockAdminUser);

      expect(result).toBeInstanceOf(ConnectionResponseDto);
      expect(result.id).toBe('connection-123');
      expect(result.name).toBe('Test Connection');
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('list', () => {
    it('should return list of connection DTOs', async () => {
      service.list.mockResolvedValue([mockConnection]);

      const result = await controller.list({}, mockAdminUser);

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(ConnectionResponseDto);
      expect(result[0].id).toBe('connection-123');
    });

    it('should pass filters to service', async () => {
      service.list.mockResolvedValue([mockConnection]);

      await controller.list({ platformType: 'prestashop' }, mockAdminUser);

      expect(service.list).toHaveBeenCalledWith({
        platformType: 'prestashop',
      });
    });
  });

  describe('get', () => {
    it('should return connection DTO', async () => {
      service.get.mockResolvedValue(mockConnection);

      const result = await controller.get('connection-123', mockAdminUser);

      expect(result).toBeInstanceOf(ConnectionResponseDto);
      expect(result.id).toBe('connection-123');
      expect(service.get).toHaveBeenCalledWith('connection-123');
    });

    it('should return real config for a viewer when demo mode is enabled (#1616)', async () => {
      demoModeService.isDemoModeEnabled.mockReturnValue(true);
      service.get.mockResolvedValue(mockConnection);

      const result = await controller.get('connection-123', {
        id: 'user-2',
        username: 'demo-viewer',
        role: 'viewer',
      });

      expect(result.config).toEqual({ baseUrl: 'https://example.com' });
    });

    it('should keep config blanked for a production viewer when demo mode is disabled (#1124)', async () => {
      demoModeService.isDemoModeEnabled.mockReturnValue(false);
      service.get.mockResolvedValue(mockConnection);

      const result = await controller.get('connection-123', {
        id: 'user-2',
        username: 'viewer',
        role: 'viewer',
      });

      expect(result.config).toEqual({});
    });

    it('should keep config blanked for an operator even when demo mode is enabled (#1124)', async () => {
      demoModeService.isDemoModeEnabled.mockReturnValue(true);
      service.get.mockResolvedValue(mockConnection);

      const result = await controller.get('connection-123', {
        id: 'user-2',
        username: 'operator',
        role: 'operator',
      });

      expect(result.config).toEqual({});
    });

    it('should project the resolved adapter variantGrouping (#1924)', async () => {
      integrationsService.resolveAdapterMetadata.mockResolvedValueOnce({
        adapterKey: 'allegro.publicapi.v1',
        platformType: 'allegro',
        supportedCapabilities: ['OfferManager'],
        variantGrouping: 'catalog-implicit',
      });
      service.get.mockResolvedValue(mockConnection);

      const result = await controller.get('connection-123', mockAdminUser);

      expect(result.variantGrouping).toBe('catalog-implicit');
    });

    it('should default variantGrouping to the locked parent-child shape when adapter metadata cannot be resolved', async () => {
      integrationsService.resolveAdapterMetadata.mockRejectedValueOnce(
        new Error('unknown adapter')
      );
      service.get.mockResolvedValue(mockConnection);

      const result = await controller.get('connection-123', mockAdminUser);

      expect(result.variantGrouping).toBe('parent-child');
    });

    it('should project the resolved adapter defaultRateLimit (#1810)', async () => {
      integrationsService.resolveAdapterMetadata.mockResolvedValueOnce({
        adapterKey: 'prestashop.webservice.v1',
        platformType: 'prestashop',
        supportedCapabilities: ['ProductMaster'],
        defaultRateLimit: { requestsPerMinute: 60, maxConcurrent: 4 },
      });
      service.get.mockResolvedValue(mockConnection);

      const result = await controller.get('connection-123', mockAdminUser);

      expect(result.defaultRateLimit).toEqual({ requestsPerMinute: 60, maxConcurrent: 4 });
    });

    it('should default defaultRateLimit to null when the adapter declares none or metadata cannot be resolved', async () => {
      integrationsService.resolveAdapterMetadata.mockRejectedValueOnce(
        new Error('unknown adapter')
      );
      service.get.mockResolvedValue(mockConnection);

      const result = await controller.get('connection-123', mockAdminUser);

      expect(result.defaultRateLimit).toBeNull();
    });
  });

  describe('update', () => {
    it('should update connection and return DTO', async () => {
      const updatedConnection = new Connection(
        'connection-123',
        'prestashop',
        'Updated Name',
        'active',
        {},
        'cred_123',
        new Date(),
        new Date(),

        undefined,
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager']
      );

      service.update.mockResolvedValue(updatedConnection);

      const dto = { name: 'Updated Name' };
      const result = await controller.update('connection-123', dto, mockAdminUser);

      expect(result).toBeInstanceOf(ConnectionResponseDto);
      expect(result.name).toBe('Updated Name');
      expect(service.update).toHaveBeenCalledWith('connection-123', {
        name: 'Updated Name',
      });
    });

    it('should handle partial updates', async () => {
      service.update.mockResolvedValue(mockConnection);

      const dto = { status: 'disabled' as const };
      await controller.update('connection-123', dto, mockAdminUser);

      expect(service.update).toHaveBeenCalledWith('connection-123', {
        status: 'disabled',
      });
    });

    // #2532: document kind, "goes first" and trigger are written through this
    // same generic PATCH via the open `config` JSONB passthrough
    // (`config.salesDocument.documentKind`, `config.invoicing.isPrimary`,
    // `config.invoicing.triggerModel` — ADR-041 decision 4, #2047, #2159). A
    // connection with no document kind is not a routing candidate at all, so
    // these three fields are load-bearing: this suite pins that the
    // controller forwards each of them to the service untouched, with no
    // schema stripping any of the three keys.
    it('should forward config.salesDocument.documentKind unchanged (#2532)', async () => {
      service.update.mockResolvedValue(mockConnection);

      const dto = { config: { salesDocument: { documentKind: 'invoice' } } };
      await controller.update('connection-123', dto, mockAdminUser);

      expect(service.update).toHaveBeenCalledWith('connection-123', {
        config: { salesDocument: { documentKind: 'invoice' } },
      });
    });

    it('should forward config.invoicing.isPrimary unchanged (#2532)', async () => {
      service.update.mockResolvedValue(mockConnection);

      const dto = { config: { invoicing: { isPrimary: true } } };
      await controller.update('connection-123', dto, mockAdminUser);

      expect(service.update).toHaveBeenCalledWith('connection-123', {
        config: { invoicing: { isPrimary: true } },
      });
    });

    it('should forward config.invoicing.triggerModel unchanged (#2532)', async () => {
      service.update.mockResolvedValue(mockConnection);

      const dto = { config: { invoicing: { triggerModel: 'on-paid' } } };
      await controller.update('connection-123', dto, mockAdminUser);

      expect(service.update).toHaveBeenCalledWith('connection-123', {
        config: { invoicing: { triggerModel: 'on-paid' } },
      });
    });

    it('should forward all three routing fields together in one write (#2532)', async () => {
      service.update.mockResolvedValue(mockConnection);

      const dto = {
        config: {
          salesDocument: { documentKind: 'fiscal-receipt' },
          invoicing: { isPrimary: false, triggerModel: 'manual' },
        },
      };
      await controller.update('connection-123', dto, mockAdminUser);

      expect(service.update).toHaveBeenCalledWith('connection-123', { config: dto.config });
    });

    it('should clear the document kind by writing an empty string, matching the FE "Nothing" option (#2532)', async () => {
      service.update.mockResolvedValue(mockConnection);

      const dto = { config: { salesDocument: { documentKind: '' } } };
      await controller.update('connection-123', dto, mockAdminUser);

      expect(service.update).toHaveBeenCalledWith('connection-123', {
        config: { salesDocument: { documentKind: '' } },
      });
    });
  });

  describe('disable', () => {
    it('should disable connection and return DTO', async () => {
      const disabledConnection = new Connection(
        'connection-123',
        'prestashop',
        'Test Connection',
        'disabled',
        {},
        'cred_123',
        new Date(),
        new Date(),

        undefined,
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager']
      );

      service.disable.mockResolvedValue(disabledConnection);

      const result = await controller.disable('connection-123', mockAdminUser);

      expect(result).toBeInstanceOf(ConnectionResponseDto);
      expect(result.status).toBe('disabled');
      expect(service.disable).toHaveBeenCalledWith('connection-123');
    });
  });

  describe('getDiagnostics', () => {
    it('delegates the whole three-source read to ConnectionDiagnosticsService', async () => {
      connectionDiagnosticsService.getDiagnostics.mockResolvedValue(diagnosticsReads());

      const result = await controller.getDiagnostics('connection-123');

      expect(connectionDiagnosticsService.getDiagnostics).toHaveBeenCalledWith('connection-123');
      expect(result).toBeInstanceOf(ConnectionDiagnosticsResponseDto);
      expect(result.connectionId).toBe('connection-123');
      expect(result.connectionName).toBe('Test Connection');
      expect(result.connectionStatus).toBe('active');
    });

    it('carries unreadableSources through to the response verbatim', async () => {
      connectionDiagnosticsService.getDiagnostics.mockResolvedValue(
        diagnosticsReads({ unreadableSources: ['fiscalRegistrations'] })
      );

      const result = await controller.getDiagnostics('connection-123');

      expect(result.unreadableSources).toEqual(['fiscalRegistrations']);
      expect(result.lastSucceededAt).toBeNull();
    });

    it('should throw NotFoundException for unknown connection', async () => {
      connectionDiagnosticsService.getDiagnostics.mockRejectedValue(
        new NotFoundException('Connection not found')
      );

      await expect(controller.getDiagnostics('unknown-id')).rejects.toBeInstanceOf(
        NotFoundException
      );
    });
  });

  describe('updateCredentials', () => {
    it('should delegate to service and return 204', async () => {
      service.updateCredentials.mockResolvedValue(undefined);

      await controller.updateCredentials('connection-123', {
        credentials: { webserviceApiKey: 'NEW_KEY' },
      });

      expect(service.updateCredentials).toHaveBeenCalledWith('connection-123', {
        webserviceApiKey: 'NEW_KEY',
      });
    });

    it('should propagate NotFoundException from service', async () => {
      service.updateCredentials.mockRejectedValue(new NotFoundException('Connection not found'));

      await expect(
        controller.updateCredentials('connection-123', { credentials: { webserviceApiKey: 'K' } })
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate BadRequestException when connection is not db-backed', async () => {
      service.updateCredentials.mockRejectedValue(
        new BadRequestException('does not have a db-backed credentials reference')
      );

      await expect(
        controller.updateCredentials('connection-123', { credentials: { webserviceApiKey: 'K' } })
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('installWebhooks', () => {
    it('delegates to ConnectionService.installWebhooks and returns the result', async () => {
      const result = await controller.installWebhooks('connection-123', {
        id: 'user-1',
        username: 'admin',
        role: 'admin',
      });

      expect(service.installWebhooks).toHaveBeenCalledWith('connection-123', 'user-1');
      expect(result).toEqual({
        webhooksConfigured: true,
        testPingTriggered: true,
      });
    });

    it('propagates BadRequestException from the service (e.g., unsupported adapter)', async () => {
      service.installWebhooks.mockRejectedValueOnce(
        new BadRequestException('Webhook auto-provisioning is not supported for adapter foo.bar.v1')
      );

      await expect(
        controller.installWebhooks('connection-123', {
          id: 'user-1',
          username: 'admin',
          role: 'admin',
        })
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('rotateWebhookSecret', () => {
    it('returns a reveal-once payload with plaintext secret', async () => {
      service.get.mockResolvedValue(mockConnection);

      const mockRes = { setHeader: jest.fn() } as never;
      const result = await controller.rotateWebhookSecret(
        'connection-123',
        {
          id: 'user-1',
          username: 'admin',
          role: 'admin',
        },
        mockRes
      );

      expect(result.secret).toBe('deadbeef');
      expect(result.revealedOnce).toBe(true);
      expect(result.warning).toMatch(/cannot be retrieved again/);
    });
  });
});
