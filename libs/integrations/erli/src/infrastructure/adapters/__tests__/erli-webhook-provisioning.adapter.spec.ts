/**
 * Erli Webhook Provisioning Adapter Tests (#996)
 *
 * Asserts the automated registration (verified against the live Erli API, #992):
 * `install` rotates the shared secret and issues `PUT /hooks/{hookName}` for the
 * order-relevant hooks with `{ url, accessToken }`, marks the connection
 * configured, and NEVER logs secret material. Fail-closed when the callback base
 * URL is missing; retry-safe failure when a PUT fails.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import { ErliConfigException } from '../../../domain/exceptions/erli-config.exception';
import type { IErliAdapterFactory } from '../../../application/interfaces/erli-adapter.factory.interface';
import type { IErliHttpClient } from '../../http/erli-http-client.interface';
import { ErliWebhookProvisioningAdapter } from '../erli-webhook-provisioning.adapter';

const CONNECTION_ID = 'conn-erli-1';
const SECRET = 'super-secret-erli-key-DO-NOT-LOG';

function buildConnection(configOverrides: Record<string, unknown> = {}): Connection {
  return {
    id: CONNECTION_ID,
    platformType: 'erli',
    name: 'My Erli',
    status: 'active',
    credentialsRef: 'erli-cred-1',
    adapterKey: 'erli.shopapi.v1',
    config: {
      baseUrl: 'https://sandbox.erli.dev/svc/shop-api',
      callbackBaseUrl: 'http://host.docker.internal:3000',
      ...configOverrides,
    },
  } as unknown as Connection;
}

describe('ErliWebhookProvisioningAdapter', () => {
  let httpClient: jest.Mocked<IErliHttpClient>;
  let factory: jest.Mocked<Pick<IErliAdapterFactory, 'createHttpClient'>>;
  let connectionPort: { get: jest.Mock; update: jest.Mock };
  let webhookSecretService: { rotate: jest.Mock };
  let credentialsResolver: { get: jest.Mock };
  let adapter: ErliWebhookProvisioningAdapter;

  beforeEach(() => {
    httpClient = {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      put: jest.fn().mockResolvedValue({ status: 200, data: undefined }),
    };
    factory = { createHttpClient: jest.fn().mockResolvedValue(httpClient) };
    connectionPort = {
      get: jest.fn().mockResolvedValue(buildConnection()),
      update: jest.fn().mockResolvedValue(undefined),
    };
    webhookSecretService = { rotate: jest.fn().mockResolvedValue({ secret: SECRET }) };
    credentialsResolver = { get: jest.fn() };
    adapter = new ErliWebhookProvisioningAdapter(
      connectionPort as never,
      webhookSecretService as never,
      credentialsResolver as never,
      factory as never,
    );
  });

  it('should register both order hooks via PUT /hooks/{name} with the callback url + secret', async () => {
    const result = await adapter.install(CONNECTION_ID, 'actor-1');

    expect(webhookSecretService.rotate).toHaveBeenCalledWith('erli', CONNECTION_ID, 'actor-1');
    expect(httpClient.put).toHaveBeenCalledTimes(2);
    const url = `http://host.docker.internal:3000/webhooks/erli/${CONNECTION_ID}`;
    // Erli's HookSave requires `hookName` in the BODY (not just the path) and
    // rejects unknown properties — the body must repeat the path hook name or
    // Erli returns 400 (regression: this was omitted and broke install live).
    expect(httpClient.put).toHaveBeenCalledWith(
      '/hooks/orderCreated',
      { hookName: 'orderCreated', url, accessToken: SECRET },
      { idempotent: true },
    );
    expect(httpClient.put).toHaveBeenCalledWith(
      '/hooks/orderStatusChanged',
      { hookName: 'orderStatusChanged', url, accessToken: SECRET },
      { idempotent: true },
    );
    expect(result).toEqual({ webhooksConfigured: true, testPingTriggered: false });
  });

  it('should mark the connection webhooksConfigured', async () => {
    await adapter.install(CONNECTION_ID);

    expect(connectionPort.update).toHaveBeenCalledWith(CONNECTION_ID, {
      config: expect.objectContaining({ webhooksConfigured: true }),
    });
  });

  it('should trim a trailing slash on the callback base URL', async () => {
    connectionPort.get.mockResolvedValue(
      buildConnection({ callbackBaseUrl: 'https://ol.example.com/' }),
    );

    await adapter.install(CONNECTION_ID);

    expect(httpClient.put).toHaveBeenCalledWith(
      '/hooks/orderCreated',
      expect.objectContaining({ url: `https://ol.example.com/webhooks/erli/${CONNECTION_ID}` }),
      { idempotent: true },
    );
  });

  it('should fail closed (no rotate, no PUT) when callbackBaseUrl is missing', async () => {
    connectionPort.get.mockResolvedValue(buildConnection({ callbackBaseUrl: undefined }));

    await expect(adapter.install(CONNECTION_ID)).rejects.toBeInstanceOf(ErliConfigException);
    expect(webhookSecretService.rotate).not.toHaveBeenCalled();
    expect(httpClient.put).not.toHaveBeenCalled();
  });

  it('should surface a retry-safe ErliConfigException when a PUT fails', async () => {
    httpClient.put.mockRejectedValueOnce(new Error('502 bad gateway'));

    await expect(adapter.install(CONNECTION_ID)).rejects.toBeInstanceOf(ErliConfigException);
  });

  it('should flip the persisted webhooksConfigured flag to false when a PUT fails', async () => {
    httpClient.put.mockRejectedValueOnce(new Error('502 bad gateway'));

    await expect(adapter.install(CONNECTION_ID)).rejects.toBeInstanceOf(ErliConfigException);
    expect(connectionPort.update).toHaveBeenCalledWith(CONNECTION_ID, {
      config: expect.objectContaining({ webhooksConfigured: false }),
    });
  });

  it('should still throw the original ErliConfigException if the fail-closed flag update also fails', async () => {
    httpClient.put.mockRejectedValueOnce(new Error('502 bad gateway'));
    connectionPort.update.mockRejectedValueOnce(new Error('db down'));

    await expect(adapter.install(CONNECTION_ID)).rejects.toBeInstanceOf(ErliConfigException);
  });

  it('should NEVER log the secret across any channel', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);

    await adapter.install(CONNECTION_ID);

    const allLogged = [logSpy, warnSpy, errorSpy, debugSpy]
      .flatMap((spy) => spy.mock.calls)
      .flatMap((call) => call.map((arg) => String(arg)))
      .join('\n');

    expect(allLogged).not.toContain(SECRET);

    jest.restoreAllMocks();
  });
});
