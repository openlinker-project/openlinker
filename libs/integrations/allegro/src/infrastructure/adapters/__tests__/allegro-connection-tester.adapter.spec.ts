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

describe('AllegroConnectionTesterAdapter', () => {
  const tester = new AllegroConnectionTesterAdapter();
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
});
