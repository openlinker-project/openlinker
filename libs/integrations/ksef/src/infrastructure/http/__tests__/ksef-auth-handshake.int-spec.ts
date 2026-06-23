/**
 * KSeF auth handshake — live test-environment integration spec (env-gated).
 *
 * This is the ONLY place that asserts behaviour "against the KSeF test
 * environment". It is gated on real sandbox credentials and SKIPS entirely when
 * they are absent — so it never runs (and never hits the network) in the fast
 * unit suite (the merge gate) or in CI without secrets.
 *
 * To run locally against the KSeF test tier, export:
 *   KSEF_TEST_TOKEN=<static authorization token issued in the KSeF test app>
 *   KSEF_TEST_NIP=<10-digit context NIP the token authenticates>
 *   # optional: KSEF_TEST_ENV=test|demo  (default: test)
 *
 *   pnpm --filter @openlinker/integrations-ksef test ksef-auth-handshake.int-spec
 *
 * What it proves end-to-end (no mocks): the real handshake fetches the MF
 * token-encryption public key, RSA-OAEP-wraps (token | challenge timestamp),
 * submits, polls the async reference to completion, redeems, and parses a real
 * access-token `exp` — and a subsequent authenticated GET succeeds with the
 * bearer the handshake produced.
 *
 * SECURITY: credentials come only from the environment; nothing is logged.
 *
 * @module libs/integrations/ksef/src/infrastructure/http
 */
import { createKsefHttpClient } from '../ksef-http-client.factory';
import type { KsefEnvironment } from '../../../domain/types/ksef-connection.types';

const token = process.env.KSEF_TEST_TOKEN;
const contextNip = process.env.KSEF_TEST_NIP;
const env = (process.env.KSEF_TEST_ENV as KsefEnvironment | undefined) ?? 'test';
const credsPresent = Boolean(token && contextNip);

// `describe.skip` when creds are absent → the whole suite is reported skipped,
// never executed, so the fast suite stays network-free and green.
const maybeDescribe = credsPresent ? describe : describe.skip;

maybeDescribe('KSeF auth handshake (live test environment)', () => {
  // 5 minutes: the async reference poll can take tens of seconds in the sandbox.
  jest.setTimeout(300_000);

  it('should complete the ksef-token handshake and produce a usable access token', async () => {
    const { handshake, httpClient } = createKsefHttpClient({
      connectionId: 'int-spec-conn',
      env,
      authMaterial: {
        authType: 'ksef-token',
        token: token as string,
        contextNip: contextNip as string,
      },
    });

    const result = await handshake.authenticate({
      authType: 'ksef-token',
      token: token as string,
      contextNip: contextNip as string,
    });

    expect(result.accessToken.split('.')).toHaveLength(3);
    expect(result.refreshToken.length).toBeGreaterThan(0);
    expect(result.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());

    // The produced bearer must be accepted by a real authenticated read.
    const ping = await httpClient.get('/security/public-key-certificates');
    expect(ping.status).toBeGreaterThanOrEqual(200);
    expect(ping.status).toBeLessThan(300);
  });
});
