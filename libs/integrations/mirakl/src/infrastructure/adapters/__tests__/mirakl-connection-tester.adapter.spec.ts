/**
 * Mirakl Connection Tester: unit tests
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';
import type { IMiraklAdapterFactory } from '../../../application/interfaces/mirakl-adapter.factory.interface';
import { MiraklApiException } from '../../../domain/exceptions/mirakl-api.exception';
import { MiraklAuthenticationException } from '../../../domain/exceptions/mirakl-authentication.exception';
import { MiraklConfigException } from '../../../domain/exceptions/mirakl-config.exception';
import { MiraklNetworkException } from '../../../domain/exceptions/mirakl-network.exception';
import { MiraklRateLimitException } from '../../../domain/exceptions/mirakl-rate-limit.exception';
import {
  MIRAKL_CONNECTION_PROBE_PATH,
  MiraklConnectionTesterAdapter,
} from '../mirakl-connection-tester.adapter';

const connection = { id: 'conn-1', config: {} } as unknown as Connection;
const credentialsResolver = {} as CredentialsResolverPort;

function setup(outcome: { status: number } | Error): {
  tester: MiraklConnectionTesterAdapter;
  get: jest.Mock;
  createClients: jest.Mock;
  forConnection: jest.Mock;
} {
  const get = jest.fn();
  if (outcome instanceof Error) {
    get.mockRejectedValue(outcome);
  } else {
    get.mockResolvedValue({ status: outcome.status, data: {} });
  }
  const createClients = jest.fn().mockResolvedValue({ httpClient: { get }, importTracker: {} });
  const forConnection = jest.fn().mockReturnValue(jest.fn());
  const tester = new MiraklConnectionTesterAdapter(
    { forConnection, evict: jest.fn() } as unknown as HttpTransportFactoryPort,
    { createClients } as unknown as IMiraklAdapterFactory,
    'Empik',
  );
  return { tester, get, createClients, forConnection };
}

describe('MiraklConnectionTesterAdapter', () => {
  it('should succeed and probe A01 through the connection transport without retries', async () => {
    const { tester, get, createClients, forConnection } = setup({ status: 200 });

    const result = await tester.test(connection, credentialsResolver);

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(get).toHaveBeenCalledWith(MIRAKL_CONNECTION_PROBE_PATH);
    expect(forConnection).toHaveBeenCalledWith(connection);
    expect((createClients.mock.calls[0] as unknown[])[3]).toMatchObject({ maxRetries: 0 });
  });

  it('should report the 401 when the key is rejected', async () => {
    const { tester } = setup(new MiraklAuthenticationException('Mirakl GET /api/account failed (401)', 401));

    await expect(tester.test(connection, credentialsResolver)).resolves.toMatchObject({
      success: false,
      status: 401,
    });
  });

  it('should report 429 when rate limited', async () => {
    const { tester } = setup(new MiraklRateLimitException('limited', 1000));

    await expect(tester.test(connection, credentialsResolver)).resolves.toMatchObject({
      success: false,
      status: 429,
    });
  });

  it('should report unreachable with a fixed message when the network fails', async () => {
    const { tester } = setup(new MiraklNetworkException('connect ECONNREFUSED 10.0.0.5:443'));

    const result = await tester.test(connection, credentialsResolver);

    expect(result).toMatchObject({ success: false, outcome: 'unreachable' });
    expect(result.message).not.toContain('10.0.0.5');
  });

  it('should report misconfigured when the connection config is unusable', async () => {
    const { tester } = setup(new MiraklConfigException('invalid shopId'));

    await expect(tester.test(connection, credentialsResolver)).resolves.toMatchObject({
      success: false,
      outcome: 'misconfigured',
    });
  });

  it('should report the status when Mirakl answers another 4xx', async () => {
    const { tester } = setup(new MiraklApiException('Mirakl GET /api/account failed (404)', 404));

    await expect(tester.test(connection, credentialsResolver)).resolves.toMatchObject({
      success: false,
      status: 404,
    });
  });

  it('should report a fixed message when the failure is not a Mirakl exception', async () => {
    const { tester } = setup(new TypeError('boom at internal-host'));

    const result = await tester.test(connection, credentialsResolver);

    expect(result.success).toBe(false);
    expect(result.message).toBe('Empik probe failed');
  });
});
