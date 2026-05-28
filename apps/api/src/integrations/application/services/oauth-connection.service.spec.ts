/**
 * OAuthConnectionService Unit Tests (#859)
 *
 * Pins the host's neutral OAuth orchestration after the Allegro relocation:
 * state lifecycle, registry dispatch, credential + connection persistence,
 * the exchange/identity error mapping (preserving the pre-relocation 400/500
 * split), the #819 re-auth-in-place path, and the #820 same-account guard
 * (now keyed on the neutral `oauthAccountId` with a `sellerId` read-fallback).
 *
 * The per-platform adapter is mocked via a fake `OAuthCompletionPort` — the
 * service never sees Allegro.
 *
 * @module apps/api/src/integrations/application/services
 */
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { OAuthCodeExchangeException } from '@openlinker/core/integrations';
import type { OAuthCompletionPort } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { OAuthConnectionService } from './oauth-connection.service';
import type { OAuthStateData } from '../interfaces/oauth-connection.service.types';

const ADAPTER_KEY = 'allegro.publicapi.v1';

/** Read a mock's first-call args as `unknown[]` so per-arg casts stay type-safe. */
function firstCallArgs(mock: jest.Mock): unknown[] {
  return mock.mock.calls[0] as unknown[];
}

describe('OAuthConnectionService', () => {
  let service: OAuthConnectionService;
  let connectionService: {
    get: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateCredentials: jest.Mock;
  };
  let redisClient: { setEx: jest.Mock; get: jest.Mock; del: jest.Mock };
  let credentials: { create: jest.Mock };
  let adapter: jest.Mocked<OAuthCompletionPort>;
  let registry: { get: jest.Mock };

  const CREDENTIAL_BLOB = {
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    expiresAt: '2026-01-01T00:00:00.000Z',
    clientId: 'client-1',
    clientSecret: 'secret-1',
  };

  function makeState(overrides: Partial<OAuthStateData> = {}): OAuthStateData {
    return {
      adapterKey: ADAPTER_KEY,
      platformType: 'allegro',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      redirectUri: 'https://ol.test/cb',
      connectionName: 'My Shop',
      initialConfig: { environment: 'sandbox' },
      ...overrides,
    };
  }

  beforeEach(() => {
    connectionService = {
      get: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateCredentials: jest.fn(),
    };
    redisClient = { setEx: jest.fn(), get: jest.fn(), del: jest.fn() };
    credentials = { create: jest.fn() };
    adapter = {
      buildAuthorizationUrl: jest.fn().mockReturnValue('https://provider.test/authorize?x=1'),
      exchangeCode: jest.fn().mockResolvedValue(CREDENTIAL_BLOB),
      fetchAccountIdentity: jest.fn().mockResolvedValue({ accountId: 'acct-1', label: 'my_shop' }),
    };
    registry = { get: jest.fn().mockReturnValue(adapter) };

    service = new OAuthConnectionService(
      connectionService as never,
      redisClient as never,
      credentials as never,
      registry as never
    );
  });

  describe('generateAuthorizationUrl', () => {
    it('persists neutral state to Redis and returns the adapter-built URL', async () => {
      const result = await service.generateAuthorizationUrl({
        adapterKey: ADAPTER_KEY,
        platformType: 'allegro',
        clientId: 'client-1',
        clientSecret: 'secret-1',
        redirectUri: 'https://ol.test/cb',
        connectionName: 'My Shop',
        initialConfig: { environment: 'sandbox' },
      });

      expect(result.authorizationUrl).toBe('https://provider.test/authorize?x=1');
      expect(typeof result.state).toBe('string');
      expect(result.state.length).toBeGreaterThan(0);

      const [key, ttl, payload] = redisClient.setEx.mock.calls[0] as [string, number, string];
      expect(key).toBe(`oauth:state:${result.state}`);
      expect(ttl).toBe(600);
      const stored = JSON.parse(payload) as OAuthStateData;
      expect(stored).toMatchObject({ adapterKey: ADAPTER_KEY, platformType: 'allegro' });

      expect(adapter.buildAuthorizationUrl).toHaveBeenCalledWith({
        clientId: 'client-1',
        redirectUri: 'https://ol.test/cb',
        state: result.state,
        config: { environment: 'sandbox' },
      });
    });

    it('honours a caller-supplied state', async () => {
      const result = await service.generateAuthorizationUrl({
        adapterKey: ADAPTER_KEY,
        platformType: 'allegro',
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'https://ol.test/cb',
        state: 'fixed-state',
      });
      expect(result.state).toBe('fixed-state');
    });

    it('throws 500 when no adapter is registered for the adapterKey', async () => {
      registry.get.mockReturnValue(undefined);
      await expect(
        service.generateAuthorizationUrl({
          adapterKey: 'unknown.v1',
          platformType: 'unknown',
          clientId: 'c',
          clientSecret: 's',
          redirectUri: 'https://ol.test/cb',
        })
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('validateState', () => {
    it('returns the parsed state and consumes the key (one-time use)', async () => {
      const state = makeState();
      redisClient.get.mockResolvedValue(JSON.stringify(state));

      const result = await service.validateState('st-1');

      expect(result).toMatchObject({ adapterKey: ADAPTER_KEY });
      expect(redisClient.del).toHaveBeenCalledWith('oauth:state:st-1');
    });

    it('returns null when the state is missing/expired', async () => {
      redisClient.get.mockResolvedValue(null);
      expect(await service.validateState('gone')).toBeNull();
    });

    it('returns null and clears the key on a parse error', async () => {
      redisClient.get.mockResolvedValue('not-json{');
      expect(await service.validateState('bad')).toBeNull();
      expect(redisClient.del).toHaveBeenCalledWith('oauth:state:bad');
    });
  });

  describe('completeAuthorization — create path', () => {
    it('persists the credential blob verbatim and creates the connection anchored on oauthAccountId', async () => {
      const created = { id: 'conn-new', name: 'My Shop' } as unknown as Connection;
      connectionService.create.mockResolvedValue(created);

      const result = await service.completeAuthorization('auth-code', makeState());

      expect(result).toBe(created);

      // Identity is fetched with the blob + the opaque config seed.
      expect(adapter.fetchAccountIdentity).toHaveBeenCalledWith({
        credentials: CREDENTIAL_BLOB,
        config: { environment: 'sandbox' },
      });

      // The blob is persisted verbatim (no host-side reshaping).
      const credCreateArg = firstCallArgs(credentials.create)[0] as {
        ref: string;
        platformType: string;
        credentialsJson: Record<string, unknown>;
      };
      expect(credCreateArg.platformType).toBe('allegro');
      expect(credCreateArg.ref).toMatch(/^oauth_allegro\.publicapi\.v1_/);
      expect(credCreateArg.credentialsJson).toBe(CREDENTIAL_BLOB);

      // The connection carries the neutral account anchor + the db: credentialsRef.
      const createArg = firstCallArgs(connectionService.create)[0] as {
        platformType: string;
        config: Record<string, unknown>;
        credentialsRef: string;
        adapterKey: string;
      };
      expect(createArg.platformType).toBe('allegro');
      expect(createArg.adapterKey).toBe(ADAPTER_KEY);
      expect(createArg.credentialsRef).toBe(`db:${credCreateArg.ref}`);
      expect(createArg.config).toEqual({ environment: 'sandbox', oauthAccountId: 'acct-1' });
    });

    it('omits oauthAccountId when the platform reports no identity (optional-identity)', async () => {
      adapter.fetchAccountIdentity.mockResolvedValue(undefined);
      connectionService.create.mockResolvedValue({ id: 'c', name: 'n' } as unknown as Connection);

      await service.completeAuthorization('auth-code', makeState());

      const createArg = firstCallArgs(connectionService.create)[0] as {
        config: Record<string, unknown>;
      };
      expect(createArg.config).toEqual({ environment: 'sandbox' });
      expect('oauthAccountId' in createArg.config).toBe(false);
    });
  });

  describe('completeAuthorization — error mapping', () => {
    it('maps OAuthCodeExchangeException to 400 (BadRequest)', async () => {
      adapter.exchangeCode.mockRejectedValue(new OAuthCodeExchangeException('bad code'));
      await expect(service.completeAuthorization('c', makeState())).rejects.toBeInstanceOf(
        BadRequestException
      );
      expect(credentials.create).not.toHaveBeenCalled();
    });

    it('maps any other exchange failure to 500 (Internal)', async () => {
      adapter.exchangeCode.mockRejectedValue(new Error('network down'));
      await expect(service.completeAuthorization('c', makeState())).rejects.toBeInstanceOf(
        InternalServerErrorException
      );
    });

    it('hard-fails with 500 when identity verification throws (never anchors unverified)', async () => {
      adapter.fetchAccountIdentity.mockRejectedValue(new Error('GET /me failed'));
      await expect(service.completeAuthorization('c', makeState())).rejects.toBeInstanceOf(
        InternalServerErrorException
      );
      expect(credentials.create).not.toHaveBeenCalled();
      expect(connectionService.create).not.toHaveBeenCalled();
    });
  });

  describe('completeAuthorization — re-auth in place (#819) + same-account guard (#820)', () => {
    it('rotates credentials and reactivates when the account matches (oauthAccountId)', async () => {
      connectionService.get.mockResolvedValue({
        id: 'conn-1',
        name: 'Existing',
        platformType: 'allegro',
        status: 'needs_reauth',
        config: { environment: 'sandbox', oauthAccountId: 'acct-1' },
      } as unknown as Connection);
      connectionService.update.mockResolvedValue({
        id: 'conn-1',
        name: 'Existing',
        status: 'active',
      } as unknown as Connection);

      await service.completeAuthorization('c', makeState({ connectionId: 'conn-1' }));

      expect(connectionService.updateCredentials).toHaveBeenCalledWith('conn-1', CREDENTIAL_BLOB);
      const updateArg = firstCallArgs(connectionService.update)[1] as {
        status: string;
        config: Record<string, unknown>;
      };
      expect(updateArg.status).toBe('active');
      expect(updateArg.config).toMatchObject({ oauthAccountId: 'acct-1' });
    });

    it('rejects a different account BEFORE rotating credentials (OAUTH_ACCOUNT_MISMATCH)', async () => {
      connectionService.get.mockResolvedValue({
        id: 'conn-1',
        name: 'Existing',
        platformType: 'allegro',
        config: { environment: 'sandbox', oauthAccountId: 'acct-OTHER' },
      } as unknown as Connection);

      await expect(
        service.completeAuthorization('c', makeState({ connectionId: 'conn-1' }))
      ).rejects.toMatchObject({ response: { code: 'OAUTH_ACCOUNT_MISMATCH' } });

      expect(connectionService.updateCredentials).not.toHaveBeenCalled();
      expect(connectionService.update).not.toHaveBeenCalled();
    });

    it('falls back to the #820-era sellerId for the guard comparison', async () => {
      connectionService.get.mockResolvedValue({
        id: 'conn-1',
        name: 'Existing',
        platformType: 'allegro',
        config: { environment: 'sandbox', sellerId: 'acct-OTHER' },
      } as unknown as Connection);

      await expect(
        service.completeAuthorization('c', makeState({ connectionId: 'conn-1' }))
      ).rejects.toMatchObject({ response: { code: 'OAUTH_ACCOUNT_MISMATCH' } });
    });

    it('backfills oauthAccountId when the existing connection has no stored account', async () => {
      connectionService.get.mockResolvedValue({
        id: 'conn-1',
        name: 'Existing',
        platformType: 'allegro',
        config: { environment: 'sandbox' },
      } as unknown as Connection);
      connectionService.update.mockResolvedValue({ id: 'conn-1', name: 'Existing' } as unknown as Connection);

      await service.completeAuthorization('c', makeState({ connectionId: 'conn-1' }));

      expect(connectionService.updateCredentials).toHaveBeenCalledWith('conn-1', CREDENTIAL_BLOB);
      const updateArg = firstCallArgs(connectionService.update)[1] as {
        config: Record<string, unknown>;
      };
      expect(updateArg.config).toMatchObject({ oauthAccountId: 'acct-1' });
    });

    it('rejects a re-auth against a connection of a different platformType', async () => {
      connectionService.get.mockResolvedValue({
        id: 'conn-1',
        name: 'PS',
        platformType: 'prestashop',
        config: {},
      } as unknown as Connection);

      await expect(
        service.completeAuthorization('c', makeState({ connectionId: 'conn-1' }))
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(connectionService.updateCredentials).not.toHaveBeenCalled();
    });
  });

  describe('completed-state markers', () => {
    it('writes the completed marker with the neutral key + TTL', async () => {
      await service.markStateCompleted('st-1', 'conn-1', 'My Shop');
      const [key, ttl, payload] = redisClient.setEx.mock.calls[0] as [string, number, string];
      expect(key).toBe('oauth:completed:st-1');
      expect(ttl).toBe(300);
      expect(JSON.parse(payload)).toEqual({ connectionId: 'conn-1', connectionName: 'My Shop' });
    });

    it('reads back a completed marker without consuming it', async () => {
      redisClient.get.mockResolvedValue(
        JSON.stringify({ connectionId: 'conn-1', connectionName: 'My Shop' })
      );
      const result = await service.checkCompletedState('st-1');
      expect(result).toEqual({ connectionId: 'conn-1', connectionName: 'My Shop' });
      expect(redisClient.del).not.toHaveBeenCalled();
    });

    it('self-heals a poisoned completed marker', async () => {
      redisClient.get.mockResolvedValue('not-json{');
      expect(await service.checkCompletedState('st-1')).toBeNull();
      expect(redisClient.del).toHaveBeenCalledWith('oauth:completed:st-1');
    });
  });
});
