/**
 * Allegro Controller Unit Tests
 *
 * Unit tests for AllegroController, verifying HTTP endpoint handling,
 * OAuth flow, connection validation, cursor queries, and command queries.
 *
 * @module apps/api/src/integrations/http
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AllegroController } from './allegro.controller';
import { AllegroOAuthService } from '../application/services/allegro-oauth.service';
import { IAllegroOAuthService } from '../application/interfaces/allegro-oauth.service.interface';
import { ConnectionCursorRepositoryPort, CONNECTION_CURSOR_REPOSITORY_TOKEN } from '@openlinker/core/sync';
import {
  AllegroQuantityCommandRepositoryPort,
  ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN,
  AllegroQuantityCommand,
} from '@openlinker/integrations-allegro';
import { Connection } from '@openlinker/core/identifier-mapping';

describe('AllegroController', () => {
  let controller: AllegroController;
  let oauthService: jest.Mocked<IAllegroOAuthService>;
  let cursorRepository: jest.Mocked<ConnectionCursorRepositoryPort>;
  let commandRepository: jest.Mocked<AllegroQuantityCommandRepositoryPort>;

  const mockConnection = new Connection(
    'connection-123',
    'allegro',
    'Test Allegro Connection',
    'active',
    { environment: 'sandbox' },
    'db:allegro_123',
    new Date('2025-01-01'),
    new Date('2025-01-01'),
  
    undefined,
    ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'Marketplace'],
  );

  beforeEach(async () => {
    const mockOAuthService = {
      generateAuthorizationUrl: jest.fn(),
      validateState: jest.fn(),
      exchangeCodeForToken: jest.fn(),
      storeCredentialsAndCreateConnection: jest.fn(),
      validateConnection: jest.fn(),
      refreshToken: jest.fn(),
      markStateCompleted: jest.fn(),
      checkCompletedState: jest.fn(),
    } as unknown as jest.Mocked<IAllegroOAuthService>;

    const mockCursorRepository = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<ConnectionCursorRepositoryPort>;

    const mockCommandRepository = {
      findByCommandId: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<AllegroQuantityCommandRepositoryPort>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AllegroController],
      providers: [
        {
          provide: AllegroOAuthService,
          useValue: mockOAuthService,
        },
        {
          provide: CONNECTION_CURSOR_REPOSITORY_TOKEN,
          useValue: mockCursorRepository,
        },
        {
          provide: ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN,
          useValue: mockCommandRepository,
        },
      ],
    }).compile();

    controller = module.get<AllegroController>(AllegroController);
    oauthService = module.get(AllegroOAuthService);
    cursorRepository = module.get(CONNECTION_CURSOR_REPOSITORY_TOKEN);
    commandRepository = module.get(ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('connect', () => {
    it('should generate OAuth authorization URL', async () => {
      const dto = {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'https://example.com/callback',
        environment: 'sandbox',
        connectionName: 'Test Connection',
      };

      const expectedResult = {
        authorizationUrl: 'https://allegro.pl.allegrosandbox.pl/auth/oauth/authorize?client_id=test-client-id&response_type=code&redirect_uri=https://example.com/callback&state=state-123',
        state: 'state-123',
      };

      oauthService.generateAuthorizationUrl.mockResolvedValue(expectedResult);

      const result = await controller.connect(dto);

      expect(result).toEqual(expectedResult);
      expect(oauthService.generateAuthorizationUrl).toHaveBeenCalledWith(
        'test-client-id',
        'test-client-secret',
        'https://example.com/callback',
        'sandbox',
        undefined,
        'Test Connection',
      );
    });

    it('should use sandbox as default environment', async () => {
      const dto = {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'https://example.com/callback',
      };

      const expectedResult = {
        authorizationUrl: 'https://allegro.pl.allegrosandbox.pl/auth/oauth/authorize?...',
        state: 'state-123',
      };

      oauthService.generateAuthorizationUrl.mockResolvedValue(expectedResult);

      await controller.connect(dto);

      expect(oauthService.generateAuthorizationUrl).toHaveBeenCalledWith(
        'test-client-id',
        'test-client-secret',
        'https://example.com/callback',
        'sandbox',
        undefined,
        undefined,
      );
    });
  });

  describe('callback', () => {
    it('should process OAuth callback and create connection', async () => {
      const query = {
        code: 'auth-code-123',
        state: 'state-123',
      };

      const stateData = {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'https://example.com/callback',
        environment: 'sandbox',
        connectionName: 'Test Connection',
      };

      const tokenResponse = {
        access_token: 'access-token-123',
        refresh_token: 'refresh-token-123',
        expires_in: 3600,
        token_type: 'Bearer',
      };

      oauthService.validateState.mockResolvedValue(stateData);
      oauthService.exchangeCodeForToken.mockResolvedValue(tokenResponse);
      oauthService.storeCredentialsAndCreateConnection.mockResolvedValue(mockConnection);
      oauthService.markStateCompleted.mockResolvedValue(undefined);

      const result = await controller.callback(query);

      expect(result).toEqual({
        message: 'OAuth callback processed successfully. Connection created.',
        connectionId: 'connection-123',
        connectionName: 'Test Allegro Connection',
      });
      expect(oauthService.validateState).toHaveBeenCalledWith('state-123');
      expect(oauthService.exchangeCodeForToken).toHaveBeenCalledWith(
        'auth-code-123',
        'test-client-id',
        'test-client-secret',
        'https://example.com/callback',
        'sandbox',
      );
      expect(oauthService.storeCredentialsAndCreateConnection).toHaveBeenCalledWith(tokenResponse, stateData);
      expect(oauthService.markStateCompleted).toHaveBeenCalledWith('state-123', 'connection-123', 'Test Allegro Connection');
    });

    it('should throw BadRequestException when state is missing', async () => {
      const query = {
        code: 'auth-code-123',
        state: undefined,
      };

      await expect(controller.callback(query)).rejects.toThrow(BadRequestException);
      await expect(controller.callback(query)).rejects.toThrow('Missing state parameter');
    });

    it('should throw BadRequestException when state is invalid and no completed marker exists', async () => {
      const query = {
        code: 'auth-code-123',
        state: 'invalid-state',
      };

      oauthService.validateState.mockResolvedValue(null);
      oauthService.checkCompletedState.mockResolvedValue(null);

      await expect(controller.callback(query)).rejects.toThrow(BadRequestException);
      await expect(controller.callback(query)).rejects.toThrow('Invalid or expired OAuth state parameter');
    });

    it('should return idempotent success when callback is replayed within completed-state TTL', async () => {
      const query = {
        code: 'auth-code-123',
        state: 'already-completed-state',
      };

      oauthService.validateState.mockResolvedValue(null);
      oauthService.checkCompletedState.mockResolvedValue({
        connectionId: 'connection-123',
        connectionName: 'Test Allegro Connection',
      });

      const result = await controller.callback(query);

      expect(result).toEqual({
        message: 'OAuth callback processed successfully. Connection created.',
        connectionId: 'connection-123',
        connectionName: 'Test Allegro Connection',
      });
      expect(oauthService.exchangeCodeForToken).not.toHaveBeenCalled();
      expect(oauthService.storeCredentialsAndCreateConnection).not.toHaveBeenCalled();
    });

    it('should handle OAuth service errors', async () => {
      const query = {
        code: 'auth-code-123',
        state: 'state-123',
      };

      oauthService.validateState.mockResolvedValue({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'https://example.com/callback',
        environment: 'sandbox',
      });
      oauthService.exchangeCodeForToken.mockRejectedValue(new Error('Token exchange failed'));

      await expect(controller.callback(query)).rejects.toThrow('Token exchange failed');
    });
  });

  describe('validate', () => {
    it('should validate connection successfully', async () => {
      const connectionId = 'connection-123';
      const validationResult = {
        valid: true,
        errors: [],
      };

      oauthService.validateConnection.mockResolvedValue(validationResult);

      const result = await controller.validate(connectionId);

      expect(result).toEqual(validationResult);
      expect(oauthService.validateConnection).toHaveBeenCalledWith(connectionId);
    });

    it('should return validation errors when connection is invalid', async () => {
      const connectionId = 'connection-123';
      const validationResult = {
        valid: false,
        errors: ['Config is missing environment', 'Connection is missing credentialsRef'],
      };

      oauthService.validateConnection.mockResolvedValue(validationResult);

      const result = await controller.validate(connectionId);

      expect(result).toEqual(validationResult);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('getCursors', () => {
    it('should return cursors for connection', async () => {
      const connectionId = 'connection-123';
      const cursorKey = 'allegro.orders.lastEventId';
      const cursorValue = 'event-123';

      cursorRepository.get.mockResolvedValue(cursorValue);

      const result = await controller.getCursors(connectionId, cursorKey);

      expect(result.cursors).toHaveLength(1);
      expect(result.cursors[0].cursorKey).toBe(cursorKey);
      expect(result.cursors[0].value).toBe(cursorValue);
      expect(cursorRepository.get).toHaveBeenCalledWith(connectionId, cursorKey);
    });

    it('should return all cursors when cursorKey not provided', async () => {
      const connectionId = 'connection-123';

      // Mock to return multiple cursors (would need list method in repository)
      // For now, we'll test with single cursor
      cursorRepository.get.mockResolvedValue('event-123');

      const result = await controller.getCursors(connectionId);

      expect(result.cursors).toBeDefined();
      expect(Array.isArray(result.cursors)).toBe(true);
    });
  });

  describe('getCommands', () => {
    it('should return commands for connection', async () => {
      const connectionId = 'connection-123';
      const commands: AllegroQuantityCommand[] = [
        AllegroQuantityCommand.create('cmd-1', connectionId, 'offer-1', 10, 'accepted'),
        AllegroQuantityCommand.create('cmd-2', connectionId, 'offer-2', 20, 'queued'),
      ];

      commandRepository.find.mockResolvedValue(commands);

      const result = await controller.getCommands(connectionId, {});

      expect(result).toHaveLength(2);
      expect(result[0].commandId).toBe('cmd-1');
      expect(result[1].commandId).toBe('cmd-2');
      expect(commandRepository.find).toHaveBeenCalledWith({
        connectionId,
        limit: undefined,
        offset: undefined,
        status: undefined,
      });
    });

    it('should filter commands by status', async () => {
      const connectionId = 'connection-123';
      const commands: AllegroQuantityCommand[] = [
        AllegroQuantityCommand.create('cmd-1', connectionId, 'offer-1', 10, 'failed'),
      ];

      commandRepository.find.mockResolvedValue(commands);

      const result = await controller.getCommands(connectionId, { status: 'failed' });

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('failed');
      expect(commandRepository.find).toHaveBeenCalledWith({
        connectionId,
        status: 'failed',
        limit: undefined,
        offset: undefined,
      });
    });

    it('should apply pagination', async () => {
      const connectionId = 'connection-123';
      const commands: AllegroQuantityCommand[] = [];

      commandRepository.find.mockResolvedValue(commands);

      await controller.getCommands(connectionId, { limit: 10, offset: 20 });

      expect(commandRepository.find).toHaveBeenCalledWith({
        connectionId,
        limit: 10,
        offset: 20,
        status: undefined,
      });
    });
  });

  describe('getFailedCommands', () => {
    it('should return failed commands for connection', async () => {
      const connectionId = 'connection-123';
      const commands: AllegroQuantityCommand[] = [
        AllegroQuantityCommand.create('cmd-1', connectionId, 'offer-1', 10, 'failed', 'Error message'),
      ];

      commandRepository.find.mockResolvedValue(commands);

      const result = await controller.getFailedCommands(connectionId);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('failed');
      expect(commandRepository.find).toHaveBeenCalledWith({
        connectionId,
        status: 'failed',
      });
    });
  });

  describe('getCommand', () => {
    it('should return command by ID for connection', async () => {
      const connectionId = 'connection-123';
      const commandId = 'cmd-123';
      const command = AllegroQuantityCommand.create(commandId, connectionId, 'offer-1', 10, 'accepted');

      commandRepository.findByCommandId.mockResolvedValue(command);

      const result = await controller.getCommand(connectionId, commandId);

      expect(result.commandId).toBe(commandId);
      expect(result.connectionId).toBe(connectionId);
      expect(commandRepository.findByCommandId).toHaveBeenCalledWith(commandId);
    });

    it('should throw NotFoundException when command not found', async () => {
      const connectionId = 'connection-123';
      const commandId = 'non-existent-cmd';

      commandRepository.findByCommandId.mockResolvedValue(null);

      await expect(controller.getCommand(connectionId, commandId)).rejects.toThrow(NotFoundException);
      await expect(controller.getCommand(connectionId, commandId)).rejects.toThrow('Command not found');
    });

    it('should throw NotFoundException when command belongs to different connection', async () => {
      const connectionId = 'connection-123';
      const commandId = 'cmd-123';
      const command = AllegroQuantityCommand.create(commandId, 'other-connection-id', 'offer-1', 10, 'accepted');

      commandRepository.findByCommandId.mockResolvedValue(command);

      await expect(controller.getCommand(connectionId, commandId)).rejects.toThrow(NotFoundException);
      await expect(controller.getCommand(connectionId, commandId)).rejects.toThrow('Command not found');
    });
  });
});

