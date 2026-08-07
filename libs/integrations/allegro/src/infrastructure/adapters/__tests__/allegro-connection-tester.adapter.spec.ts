/**
 * Allegro Connection Tester Adapter Unit Tests
 *
 * Exercises the error-translation path so failures produce structured,
 * UI-safe ConnectionTestResult values instead of throwing.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters/__tests__
 */
import { AllegroConnectionTesterAdapter } from '../allegro-connection-tester.adapter';
import * as client from '../../http/allegro-http-client';
import { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';

describe('AllegroConnectionTesterAdapter', () => {
  const http: jest.Mocked<HttpTransportFactoryPort> = {
    forConnection: jest.fn().mockReturnValue(jest.fn()),
    evict: jest.fn(),
  };
  // An arbitrary stand-in for whatever the registration site passes — what the
  // assertion below pins is the WIRING, that the fallback is INJECTED rather
  // than imported back from the plugin module (which would be a cycle:
  // plugin -> tester -> plugin).
  const defaultRateLimit = { requestsPerMinute: 1, maxConcurrent: 1 };
  const tester = new AllegroConnectionTesterAdapter(http, defaultRateLimit);
  const resolver: CredentialsResolverPort = {
    get: jest.fn().mockResolvedValue({ accessToken: 'T' }),
  } as unknown as CredentialsResolverPort;
  const connection = new Connection(
    'c1',
    'allegro',
    'X',
    'active',
    { environment: 'sandbox' },
    'db:ref',
    new Date(),
    new Date(),
    undefined,
    ['OfferManager'],
  );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns success with the response status when the probe call resolves', async () => {
    jest
      .spyOn(client.AllegroHttpClient.prototype, 'get')
      .mockResolvedValue({ status: 200, body: {}, headers: {} } as never);

    const result = await tester.test(connection, resolver);

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.message).toBe('OK');
  });

  it('maps thrown errors to success:false with statusCode propagated', async () => {
    const err = Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    jest.spyOn(client.AllegroHttpClient.prototype, 'get').mockRejectedValue(err);

    const result = await tester.test(connection, resolver);

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(result.message).toBe('Unauthorized');
  });

  it('resolves the probe transport with the injected defaultRateLimit, so the test-connection click shares the connection bucket', async () => {
    // Regression guard for a silent bypass: dropping the second argument still
    // compiles (it is optional) and every assertion above still passes, but the
    // probe would resolve an UNLIMITED bucket while the real clients pace
    // against the manifest fallback. Only this assertion notices.
    jest
      .spyOn(client.AllegroHttpClient.prototype, 'get')
      .mockResolvedValue({ status: 200, body: {}, headers: {} } as never);

    await tester.test(connection, resolver);

    expect(http.forConnection).toHaveBeenCalledWith(connection, defaultRateLimit);
  });
});
