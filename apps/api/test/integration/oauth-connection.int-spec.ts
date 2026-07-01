/**
 * OAuth Connection — Integration (#859)
 *
 * Exercises the relocated OAuth surface end-to-end through the REAL wiring:
 * HTTP → AllegroController → neutral OAuthConnectionService → the real
 * OAuthCompletionRegistryService (Allegro adapter registered at boot) → the
 * real ConnectionService / credentials store / Redis state — with only
 * Allegro's outbound token + `/me` HTTP calls network-stubbed via `global.fetch`.
 *
 * This proves the registry seam actually resolves the Allegro adapter, the
 * normalized credential blob round-trips through encryption, and the #819
 * re-auth + #820 same-account guard hold against real Postgres + Redis. The
 * neutral service's platform-agnostic orchestration (the seam works for ANY
 * OAuthCompletionPort, idempotency, optional-identity) is covered hermetically
 * in `oauth-connection.service.spec.ts` with a fake port; a fully-fake platform
 * can't traverse the real `ConnectionService.create` (which resolves adapter
 * metadata), so the integration value lives on the real-adapter path here.
 *
 * @module apps/api/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';
import { ConnectionService } from '../../src/integrations/application/services/connection.service';
import {
  CREDENTIALS_RESOLVER_TOKEN,
  type CredentialsResolverPort,
} from '@openlinker/core/integrations';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';

const REDIRECT_URI = 'https://api.openlinker.test/integrations/allegro/oauth/callback';

// Mutable per-test stub config read by the global.fetch mock.
let meSellerId = 'SELLER_A';
let meLogin = 'shop_a';
let tokenOk = true;
let tokenCallCount = 0;

function installFetchStub(): void {
  global.fetch = jest.fn(async (input: unknown): Promise<Response> => {
    const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input);

    if (url.includes('/auth/oauth/token')) {
      if (!tokenOk) {
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: () => Promise.resolve('invalid_grant'),
        } as unknown as Response;
      }
      tokenCallCount += 1;
      return {
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            access_token: `at-${tokenCallCount}`,
            refresh_token: `rt-${tokenCallCount}`,
            expires_in: 3600,
            token_type: 'bearer',
          }),
      } as unknown as Response;
    }

    if (url.includes('/me')) {
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: meSellerId, login: meLogin }),
      } as unknown as Response;
    }

    throw new Error(`Unexpected fetch in OAuth int-spec: ${url}`);
  }) as unknown as typeof fetch;
}

describe('OAuth Connection (integration)', () => {
  let harness: IntegrationTestHarness;
  const originalFetch = global.fetch;

  // The 120s default hook timeout is enough in isolation (~27s boot), but the
  // first-call boot can exceed it under full-suite contention. Five minutes
  // matches the testing-guide's recommendation for slow-startup paths.
  beforeAll(async () => {
    harness = await getTestHarness();
  }, 300_000);

  afterEach(async () => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(() => {
    meSellerId = 'SELLER_A';
    meLogin = 'shop_a';
    tokenOk = true;
    tokenCallCount = 0;
  });

  function connectionService(): ConnectionService {
    return harness.getApp().get(ConnectionService, { strict: false });
  }

  function credentialsResolver(): CredentialsResolverPort {
    return harness.getApp().get<CredentialsResolverPort>(CREDENTIALS_RESOLVER_TOKEN, {
      strict: false,
    });
  }

  /** Count persisted Allegro connections via the ORM entity (column-name agnostic). */
  async function countAllegroConnections(): Promise<number> {
    return harness
      .getDataSource()
      .getRepository(ConnectionOrmEntity)
      .count({ where: { platformType: 'allegro' } });
  }

  /** Run the connect step and return the OAuth `state`. */
  async function connect(
    token: string,
    body: Record<string, unknown> = {}
  ): Promise<string> {
    const res = await harness
      .getHttp()
      .post('/v1/integrations/allegro/oauth/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({
        clientId: 'client-1',
        clientSecret: 'secret-1',
        redirectUri: REDIRECT_URI,
        environment: 'sandbox',
        ...body,
      })
      .expect(200);
    return res.body.state as string;
  }

  it('completes the OAuth flow: persists the connection anchored on the verified account and a round-trippable credential blob', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
    const state = await connect(token, { connectionName: 'My Allegro Store' });

    installFetchStub();
    const res = await harness
      .getHttp()
      .get('/v1/integrations/allegro/oauth/callback')
      .query({ code: 'auth-code-1', state })
      .expect(200);

    expect(res.body.connectionId).toBeDefined();
    expect(res.body.connectionName).toBe('My Allegro Store');

    const connection = await connectionService().get(res.body.connectionId as string);
    expect(connection.platformType).toBe('allegro');
    expect(connection.adapterKey).toBe('allegro.publicapi.v1');
    expect((connection.config as { oauthAccountId?: string }).oauthAccountId).toBe('SELLER_A');
    expect((connection.config as { environment?: string }).environment).toBe('sandbox');
    expect(connection.credentialsRef).toMatch(/^db:oauth_allegro\.publicapi\.v1_/);

    // The normalized credential blob round-trips through encryption with
    // exactly the keys AllegroTokenRefreshService reads back at runtime.
    const blob = await credentialsResolver().get<Record<string, unknown>>(connection.credentialsRef!);
    expect(Object.keys(blob).sort()).toEqual(
      ['accessToken', 'clientId', 'clientSecret', 'expiresAt', 'refreshToken'].sort()
    );
    expect(blob.accessToken).toBe('at-1');
    expect(blob.clientId).toBe('client-1');
  });

  it('replays an already-completed callback idempotently within the TTL window', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
    const state = await connect(token);

    installFetchStub();
    const first = await harness
      .getHttp()
      .get('/v1/integrations/allegro/oauth/callback')
      .query({ code: 'auth-code-1', state })
      .expect(200);

    // Replay the SAME state — the one-time state is consumed, so this hits the
    // completed-marker path and returns the same connection without re-running.
    const replay = await harness
      .getHttp()
      .get('/v1/integrations/allegro/oauth/callback')
      .query({ code: 'auth-code-1', state })
      .expect(200);

    expect(replay.body.connectionId).toBe(first.body.connectionId);
    expect(await countAllegroConnections()).toBe(1);
  });

  it('re-authenticates an existing connection in place when the account matches (#819)', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());

    // First flow → create the connection (SELLER_A).
    installFetchStub();
    const state1 = await connect(token, { connectionName: 'Store' });
    const created = await harness
      .getHttp()
      .get('/v1/integrations/allegro/oauth/callback')
      .query({ code: 'code-1', state: state1 })
      .expect(200);
    const connectionId = created.body.connectionId as string;

    // Second flow → re-auth in place; same seller → success, credentials rotated.
    const state2 = await connect(token, { connectionId });
    const reauth = await harness
      .getHttp()
      .get('/v1/integrations/allegro/oauth/callback')
      .query({ code: 'code-2', state: state2 })
      .expect(200);

    expect(reauth.body.connectionId).toBe(connectionId);
    const connection = await connectionService().get(connectionId);
    expect(connection.status).toBe('active');
    const blob = await credentialsResolver().get<Record<string, unknown>>(connection.credentialsRef!);
    expect(blob.accessToken).toBe('at-2'); // rotated to the 2nd token
  });

  it('rejects re-auth for a different account before rotating credentials (#820)', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());

    installFetchStub();
    const state1 = await connect(token, { connectionName: 'Store' });
    const created = await harness
      .getHttp()
      .get('/v1/integrations/allegro/oauth/callback')
      .query({ code: 'code-1', state: state1 })
      .expect(200);
    const connectionId = created.body.connectionId as string;

    // Re-auth with a DIFFERENT seller → 400 OAUTH_ACCOUNT_MISMATCH.
    meSellerId = 'SELLER_B';
    meLogin = 'shop_b';
    const state2 = await connect(token, { connectionId });
    const res = await harness
      .getHttp()
      .get('/v1/integrations/allegro/oauth/callback')
      .query({ code: 'code-2', state: state2 })
      .expect(400);
    expect(res.body.code).toBe('OAUTH_ACCOUNT_MISMATCH');

    // Guard ran BEFORE rotation: account anchor + credentials unchanged.
    const connection = await connectionService().get(connectionId);
    expect((connection.config as { oauthAccountId?: string }).oauthAccountId).toBe('SELLER_A');
    const blob = await credentialsResolver().get<Record<string, unknown>>(connection.credentialsRef!);
    expect(blob.accessToken).toBe('at-1'); // not rotated to the mismatched token
  });

  it('returns 400 (not 500) when the provider rejects the authorization code', async () => {
    const token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
    const state = await connect(token);

    installFetchStub();
    tokenOk = false; // provider rejects the code → OAuthCodeExchangeException → 400
    await harness
      .getHttp()
      .get('/v1/integrations/allegro/oauth/callback')
      .query({ code: 'bad-code', state })
      .expect(400);

    expect(await countAllegroConnections()).toBe(0);
  });
});
