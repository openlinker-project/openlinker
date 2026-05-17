/**
 * AllegroOAuthService Unit Tests
 *
 * Unit tests for AllegroOAuthService, covering OAuth state lifecycle,
 * idempotency marker write/read, and error branches.
 *
 * @module apps/api/src/integrations/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { AllegroOAuthService } from './allegro-oauth.service';
import { ConnectionService } from './connection.service';
import type { ICredentialsService } from '@openlinker/core/integrations';
import { CREDENTIALS_SERVICE_TOKEN } from '@openlinker/core/integrations';

describe('AllegroOAuthService', () => {
  let service: AllegroOAuthService;
  let redisClient: {
    get: jest.Mock;
    setEx: jest.Mock;
    del: jest.Mock;
  };
  let credentials: jest.Mocked<ICredentialsService>;
  let connectionService: jest.Mocked<Pick<ConnectionService, 'get' | 'create'>>;

  beforeEach(async () => {
    redisClient = {
      get: jest.fn(),
      setEx: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };

    credentials = {
      create: jest.fn(),
    } as unknown as jest.Mocked<ICredentialsService>;

    connectionService = {
      get: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<Pick<ConnectionService, 'get' | 'create'>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AllegroOAuthService,
        { provide: ConnectionService, useValue: connectionService },
        { provide: 'REDIS_CLIENT', useValue: redisClient },
        { provide: CREDENTIALS_SERVICE_TOKEN, useValue: credentials },
      ],
    }).compile();

    service = module.get<AllegroOAuthService>(AllegroOAuthService);
  });

  const originalFetch = global.fetch;

  afterEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
  });

  // Tests need to assert on the private `logger` instance. Centralised to avoid
  // repeating the cast shape in every test body. Return type preserves the
  // parameter shape so `.mock.calls[0]?.[0]` narrows to `unknown` (not `any`).
  function spyOnLoggerError(): jest.SpiedFunction<(...args: unknown[]) => void> {
    return jest.spyOn(
      (service as unknown as { logger: { error: (...args: unknown[]) => void } }).logger,
      'error'
    );
  }

  describe('markStateCompleted', () => {
    it('should write completed marker to Redis with correct key, TTL, and payload', async () => {
      await service.markStateCompleted('state-abc', 'conn-1', 'My Allegro');

      expect(redisClient.setEx).toHaveBeenCalledWith(
        'allegro:oauth:completed:state-abc',
        300,
        JSON.stringify({ connectionId: 'conn-1', connectionName: 'My Allegro' })
      );
    });

    it('should propagate Redis errors', async () => {
      redisClient.setEx.mockRejectedValue(new Error('Redis unavailable'));

      await expect(service.markStateCompleted('state-abc', 'conn-1', 'My Allegro')).rejects.toThrow(
        'Redis unavailable'
      );
    });
  });

  describe('checkCompletedState', () => {
    it('should return parsed CompletedStateData when key exists', async () => {
      redisClient.get.mockResolvedValue(
        JSON.stringify({ connectionId: 'conn-1', connectionName: 'My Allegro' })
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

    it('should return null and drop poisoned marker when stored value is invalid JSON', async () => {
      redisClient.get.mockResolvedValue('not-valid-json{{{');

      const result = await service.checkCompletedState('state-abc');

      expect(result).toBeNull();
      expect(redisClient.del).toHaveBeenCalledWith('allegro:oauth:completed:state-abc');
    });

    it('should not delete the marker on successful read (read-only, idempotent)', async () => {
      redisClient.get.mockResolvedValue(
        JSON.stringify({ connectionId: 'conn-1', connectionName: 'My Allegro' })
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

  describe('generateAuthorizationUrl', () => {
    it('should store masterCatalogConnectionId in Redis state when provided', async () => {
      const masterCatalogConnectionId = '123e4567-e89b-12d3-a456-426614174000';

      await service.generateAuthorizationUrl(
        'cid',
        'csec',
        'https://example.com/cb',
        'sandbox',
        undefined,
        'My Store',
        masterCatalogConnectionId
      );

      expect(redisClient.setEx).toHaveBeenCalledWith(
        expect.stringMatching(/^allegro:oauth:state:/),
        600,
        expect.stringContaining(masterCatalogConnectionId)
      );
    });

    it('should not include masterCatalogConnectionId in state when not provided', async () => {
      await service.generateAuthorizationUrl('cid', 'csec', 'https://example.com/cb');

      const rawCall = redisClient.setEx.mock.calls[0] as unknown[];
      const storedJson = JSON.parse(rawCall[2] as string) as Record<string, unknown>;

      expect(storedJson.masterCatalogConnectionId).toBeUndefined();
    });
  });

  describe('storeCredentialsAndCreateConnection', () => {
    it('should set masterCatalogConnectionId in connection config when present in stateData', async () => {
      const masterCatalogConnectionId = '123e4567-e89b-12d3-a456-426614174000';
      credentials.create.mockResolvedValue(undefined as never);
      connectionService.create.mockResolvedValue({ id: 'conn-1', name: 'Test' } as never);

      await service.storeCredentialsAndCreateConnection(
        { access_token: 'tok', token_type: 'bearer' },
        {
          clientId: 'cid',
          clientSecret: 'csec',
          redirectUri: 'https://example.com/cb',
          environment: 'sandbox',
          masterCatalogConnectionId,
        }
      );

      expect(connectionService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ masterCatalogConnectionId }),
        })
      );
    });

    it('should not include masterCatalogConnectionId in config when absent from stateData', async () => {
      credentials.create.mockResolvedValue(undefined as never);
      connectionService.create.mockResolvedValue({ id: 'conn-1', name: 'Test' } as never);

      await service.storeCredentialsAndCreateConnection(
        { access_token: 'tok', token_type: 'bearer' },
        {
          clientId: 'cid',
          clientSecret: 'csec',
          redirectUri: 'https://example.com/cb',
          environment: 'sandbox',
        }
      );

      const createCall = (connectionService.create as jest.Mock).mock.calls[0] as unknown[];
      const createdConfig = (createCall[0] as { config: Record<string, unknown> }).config;
      expect(createdConfig.masterCatalogConnectionId).toBeUndefined();
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
        service.exchangeCodeForToken('bad-code', 'cid', 'csec', 'https://example.com/cb', 'sandbox')
      ).rejects.toThrow(BadRequestException);
    });

    it('should surface cause.code and cause.message in the log when fetch rejects with an undici-style cause', async () => {
      const loggerError = spyOnLoggerError();

      const networkError = Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:443' },
      });
      global.fetch = jest.fn().mockRejectedValue(networkError);

      await expect(
        service.exchangeCodeForToken(
          'super-secret-auth-code',
          'cid',
          'super-secret-client-secret',
          'https://example.com/cb',
          'sandbox'
        )
      ).rejects.toThrow(InternalServerErrorException);

      expect(loggerError).toHaveBeenCalled();
      const firstArg = loggerError.mock.calls[0]?.[0] as string;
      expect(firstArg).toContain('ECONNREFUSED');
      expect(firstArg).toContain('connect ECONNREFUSED 127.0.0.1:443');
      expect(firstArg).toContain('environment: sandbox');

      // Secret safety — nothing sensitive must appear in the log line
      expect(firstArg).not.toContain('super-secret-auth-code');
      expect(firstArg).not.toContain('super-secret-client-secret');
      expect(firstArg).not.toContain(
        Buffer.from('cid:super-secret-client-secret').toString('base64')
      );
    });

    it('should fall back to cause: unknown when cause has no code', async () => {
      const loggerError = spyOnLoggerError();

      const networkError = Object.assign(new TypeError('fetch failed'), {
        cause: { message: 'something broke' },
      });
      global.fetch = jest.fn().mockRejectedValue(networkError);

      await expect(
        service.exchangeCodeForToken('code', 'cid', 'csec', 'https://example.com/cb', 'sandbox')
      ).rejects.toThrow(InternalServerErrorException);

      const firstArg = loggerError.mock.calls[0]?.[0] as string;
      expect(firstArg).toContain('cause: unknown — something broke');
    });

    it('should surface joined codes when cause is AggregateError-shaped', async () => {
      const loggerError = spyOnLoggerError();

      const networkError = Object.assign(new TypeError('fetch failed'), {
        cause: {
          errors: [
            Object.assign(new Error('dns v4'), { code: 'ENOTFOUND' }),
            Object.assign(new Error('dns v6'), { code: 'EAI_AGAIN' }),
          ],
        },
      });
      global.fetch = jest.fn().mockRejectedValue(networkError);

      await expect(
        service.exchangeCodeForToken('code', 'cid', 'csec', 'https://example.com/cb', 'sandbox')
      ).rejects.toThrow(InternalServerErrorException);

      const firstArg = loggerError.mock.calls[0]?.[0] as string;
      expect(firstArg).toContain('cause: aggregate — ENOTFOUND, EAI_AGAIN');
    });

    it('should surface the timeout duration when fetch rejects with AbortError', async () => {
      const loggerError = spyOnLoggerError();

      const abortError = Object.assign(new Error('The operation was aborted'), {
        name: 'AbortError',
      });
      global.fetch = jest.fn().mockRejectedValue(abortError);

      await expect(
        service.exchangeCodeForToken('code', 'cid', 'csec', 'https://example.com/cb', 'sandbox')
      ).rejects.toThrow(InternalServerErrorException);

      const firstArg = loggerError.mock.calls[0]?.[0] as string;
      expect(firstArg).toContain('request aborted after 10000ms');
      expect(firstArg).toContain('environment: sandbox');
    });

    it('should pass an AbortSignal to fetch so fetchWithTimeout can cancel hung requests', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ access_token: 't', token_type: 'bearer' }),
      } as unknown as Response);
      global.fetch = fetchMock;

      await service.exchangeCodeForToken(
        'code',
        'cid',
        'csec',
        'https://example.com/cb',
        'sandbox'
      );

      const call = fetchMock.mock.calls[0] as [string, RequestInit] | undefined;
      expect(call?.[1].signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('refreshToken', () => {
    it('should surface cause.code in the log when fetch rejects with an undici-style cause', async () => {
      const loggerError = spyOnLoggerError();

      const networkError = Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND allegro.pl' },
      });
      global.fetch = jest.fn().mockRejectedValue(networkError);

      await expect(
        service.refreshToken(
          'super-secret-refresh-token',
          'cid',
          'super-secret-client-secret',
          'sandbox'
        )
      ).rejects.toThrow(InternalServerErrorException);

      const firstArg = loggerError.mock.calls[0]?.[0] as string;
      expect(firstArg).toContain('Error refreshing token');
      expect(firstArg).toContain('ENOTFOUND');
      expect(firstArg).toContain('getaddrinfo ENOTFOUND allegro.pl');

      // Secret safety
      expect(firstArg).not.toContain('super-secret-refresh-token');
      expect(firstArg).not.toContain('super-secret-client-secret');
    });

    it('should surface the timeout duration when fetch rejects with AbortError', async () => {
      const loggerError = spyOnLoggerError();

      const abortError = Object.assign(new Error('The operation was aborted'), {
        name: 'AbortError',
      });
      global.fetch = jest.fn().mockRejectedValue(abortError);

      await expect(service.refreshToken('rt', 'cid', 'csec', 'production')).rejects.toThrow(
        InternalServerErrorException
      );

      const firstArg = loggerError.mock.calls[0]?.[0] as string;
      expect(firstArg).toContain('Error refreshing token');
      expect(firstArg).toContain('environment: production');
      expect(firstArg).toContain('request aborted after 10000ms');
    });

    it('should pass an AbortSignal to fetch so fetchWithTimeout can cancel hung requests', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ access_token: 't', token_type: 'bearer' }),
      } as unknown as Response);
      global.fetch = fetchMock;

      await service.refreshToken('rt', 'cid', 'csec', 'sandbox');

      const call = fetchMock.mock.calls[0] as [string, RequestInit] | undefined;
      expect(call?.[1].signal).toBeInstanceOf(AbortSignal);
    });

    it('should throw BadRequestException when token endpoint returns non-OK status', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: jest.fn().mockResolvedValue('invalid_grant'),
      } as unknown as Response);

      await expect(
        service.refreshToken('bad-refresh-token', 'cid', 'csec', 'sandbox')
      ).rejects.toThrow(BadRequestException);
    });
  });
});
