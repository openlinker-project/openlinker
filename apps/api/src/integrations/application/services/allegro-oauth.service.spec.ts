/**
 * AllegroOAuthService Unit Tests
 *
 * Unit tests for AllegroOAuthService, covering OAuth state lifecycle,
 * idempotency marker write/read, and error branches.
 *
 * @module apps/api/src/integrations/application/services
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AllegroOAuthService } from './allegro-oauth.service';
import { ConnectionService } from './connection.service';
import {
  INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN,
  IntegrationCredentialRepositoryPort,
} from '@openlinker/core/integrations';

describe('AllegroOAuthService', () => {
  let service: AllegroOAuthService;
  let redisClient: {
    get: jest.Mock;
    setEx: jest.Mock;
    del: jest.Mock;
  };
  let credentialRepository: jest.Mocked<IntegrationCredentialRepositoryPort>;
  let connectionService: jest.Mocked<Pick<ConnectionService, 'get' | 'create'>>;

  beforeEach(async () => {
    redisClient = {
      get: jest.fn(),
      setEx: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };

    credentialRepository = {
      create: jest.fn(),
      findByRef: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<IntegrationCredentialRepositoryPort>;

    connectionService = {
      get: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<Pick<ConnectionService, 'get' | 'create'>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AllegroOAuthService,
        { provide: ConnectionService, useValue: connectionService },
        { provide: 'REDIS_CLIENT', useValue: redisClient },
        { provide: INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN, useValue: credentialRepository },
      ],
    }).compile();

    service = module.get<AllegroOAuthService>(AllegroOAuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('markStateCompleted', () => {
    it('should write completed marker to Redis with correct key, TTL, and payload', async () => {
      await service.markStateCompleted('state-abc', 'conn-1', 'My Allegro');

      expect(redisClient.setEx).toHaveBeenCalledWith(
        'allegro:oauth:completed:state-abc',
        300,
        JSON.stringify({ connectionId: 'conn-1', connectionName: 'My Allegro' }),
      );
    });

    it('should propagate Redis errors', async () => {
      redisClient.setEx.mockRejectedValue(new Error('Redis unavailable'));

      await expect(service.markStateCompleted('state-abc', 'conn-1', 'My Allegro')).rejects.toThrow(
        'Redis unavailable',
      );
    });
  });

  describe('checkCompletedState', () => {
    it('should return parsed CompletedStateData when key exists', async () => {
      redisClient.get.mockResolvedValue(
        JSON.stringify({ connectionId: 'conn-1', connectionName: 'My Allegro' }),
      );

      const result = await service.checkCompletedState('state-abc');

      expect(redisClient.get).toHaveBeenCalledWith('allegro:oauth:completed:state-abc');
      expect(result).toEqual({ connectionId: 'conn-1', connectionName: 'My Allegro' });
    });

    it('should return null when key does not exist', async () => {
      redisClient.get.mockResolvedValue(null);

      const result = await service.checkCompletedState('state-abc');

      expect(result).toBeNull();
    });

    it('should return null (not throw) when stored value is invalid JSON', async () => {
      redisClient.get.mockResolvedValue('not-valid-json{{{');

      const result = await service.checkCompletedState('state-abc');

      expect(result).toBeNull();
    });

    it('should not delete the marker (read-only, idempotent)', async () => {
      redisClient.get.mockResolvedValue(
        JSON.stringify({ connectionId: 'conn-1', connectionName: 'My Allegro' }),
      );

      await service.checkCompletedState('state-abc');

      expect(redisClient.del).not.toHaveBeenCalled();
    });
  });

  describe('validateState', () => {
    it('should return state data and delete the key on valid state', async () => {
      const stateData = {
        clientId: 'cid',
        clientSecret: 'csec',
        redirectUri: 'https://example.com/cb',
        environment: 'sandbox',
      };
      redisClient.get.mockResolvedValue(JSON.stringify(stateData));

      const result = await service.validateState('state-xyz');

      expect(result).toEqual(stateData);
      expect(redisClient.del).toHaveBeenCalledWith('allegro:oauth:state:state-xyz');
    });

    it('should return null when state key does not exist', async () => {
      redisClient.get.mockResolvedValue(null);

      const result = await service.validateState('missing-state');

      expect(result).toBeNull();
      expect(redisClient.del).not.toHaveBeenCalled();
    });

    it('should return null and clean up when stored value is invalid JSON', async () => {
      redisClient.get.mockResolvedValue('broken{json');

      const result = await service.validateState('bad-state');

      expect(result).toBeNull();
      expect(redisClient.del).toHaveBeenCalledWith('allegro:oauth:state:bad-state');
    });
  });

  describe('exchangeCodeForToken', () => {
    it('should throw BadRequestException when token endpoint returns non-OK status', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: jest.fn().mockResolvedValue('invalid_grant'),
      } as unknown as Response);

      await expect(
        service.exchangeCodeForToken('bad-code', 'cid', 'csec', 'https://example.com/cb', 'sandbox'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
