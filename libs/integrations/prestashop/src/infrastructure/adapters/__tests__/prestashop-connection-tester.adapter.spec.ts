/**
 * PrestaShop Connection Tester Adapter Unit Tests
 *
 * Exercises the error-translation path so failures produce structured,
 * UI-safe ConnectionTestResult values instead of throwing.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import { PrestashopConnectionTesterAdapter } from '../prestashop-connection-tester.adapter';
import * as client from '../../http/prestashop-webservice.client';
import { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';

describe('PrestashopConnectionTesterAdapter', () => {
  const tester = new PrestashopConnectionTesterAdapter();
  const resolver: CredentialsResolverPort = {
    get: jest.fn().mockResolvedValue({ webserviceApiKey: 'K' }),
  } as unknown as CredentialsResolverPort;
  const connection = new Connection(
    'c1',
    'prestashop',
    'X',
    'active',
    { baseUrl: 'https://shop.example' },
    'db:ref',
    new Date(),
    new Date(),
    undefined,
    ['ProductMaster'],
  );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns success when the probe call resolves', async () => {
    jest
      .spyOn(client.PrestashopWebserviceClient.prototype, 'listResources')
      .mockResolvedValue([]);

    const result = await tester.test(connection, resolver);

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.message).toBe('OK');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('maps auth failures to success:false with status 401', async () => {
    const err = Object.assign(new Error('Bad key'), {
      name: 'PrestashopAuthenticationException',
    });
    jest
      .spyOn(client.PrestashopWebserviceClient.prototype, 'listResources')
      .mockRejectedValue(err);

    const result = await tester.test(connection, resolver);

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(result.message).toBe('Bad key');
  });

  it('propagates explicit statusCode from API exceptions', async () => {
    const err = Object.assign(new Error('Server error'), { statusCode: 503 });
    jest
      .spyOn(client.PrestashopWebserviceClient.prototype, 'listResources')
      .mockRejectedValue(err);

    const result = await tester.test(connection, resolver);

    expect(result.success).toBe(false);
    expect(result.status).toBe(503);
  });

  it('fails gracefully when baseUrl is missing', async () => {
    const broken = new Connection(
      'c2',
      'prestashop',
      'X',
      'active',
      {},
      'db:ref',
      new Date(),
      new Date(),
      undefined,
      [],
    );

    const result = await tester.test(broken, resolver);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/baseUrl/);
  });
});
