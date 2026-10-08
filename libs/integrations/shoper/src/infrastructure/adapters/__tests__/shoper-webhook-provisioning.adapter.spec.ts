import { BadRequestException } from '@nestjs/common';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort, IWebhookSecretService } from '@openlinker/core/integrations';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';
import { Logger } from '@openlinker/shared/logging';

import { ShoperWebhookProvisioningAdapter, redactSecret } from '../shoper-webhook-provisioning.adapter';

const CONNECTION_ID = '11111111-2222-3333-4444-555555555555';
const SECRET = 'S3cr3t+/=value';
const ENCODED_SECRET = encodeURIComponent(SECRET);
const CALLBACK = 'https://ol.example.com';
const ENDPOINT = `${CALLBACK}/webhooks/shoper/${CONNECTION_ID}`;

interface ShopWebhook {
  webhook_id: string;
  url: string;
  events?: string[];
}

interface Fixture {
  adapter: ShoperWebhookProvisioningAdapter;
  connectionPort: jest.Mocked<Pick<ConnectionPort, 'get' | 'update'>>;
  secretService: jest.Mocked<Pick<IWebhookSecretService, 'rotate'>>;
  fetchMock: jest.Mock;
  calls: Array<{ method: string; path: string; body: Record<string, unknown> | null }>;
  shop: { webhooks: ShopWebhook[] };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function setup(
  options: {
    config?: Record<string, unknown>;
    enabledCapabilities?: string[];
    shopWebhooks?: ShopWebhook[];
    failWrite?: (method: string, body: Record<string, unknown>) => Response | null;
    pageSize?: number;
  } = {},
): Fixture {
  const shop = { webhooks: options.shopWebhooks ?? [] };
  const calls: Fixture['calls'] = [];
  const fetchMock = jest.fn((url: string, init: RequestInit) => {
    const parsed = new URL(url);
    const path = parsed.pathname.replace('/webapi/rest', '');
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method, path, body });

    if (method === 'GET' && path === '/webhooks') {
      const limit = Number(parsed.searchParams.get('limit'));
      const page = Number(parsed.searchParams.get('page'));
      const size = options.pageSize ?? limit;
      const slice = shop.webhooks.slice((page - 1) * size, page * size);
      return Promise.resolve(
        jsonResponse(200, {
          count: String(shop.webhooks.length),
          pages: Math.max(1, Math.ceil(shop.webhooks.length / size)),
          page,
          list: slice,
        }),
      );
    }
    const failure = options.failWrite?.(method, body ?? {});
    if (failure) {
      return Promise.resolve(failure);
    }
    if (method === 'POST' && path === '/webhooks') {
      const id = String(100 + shop.webhooks.length);
      shop.webhooks.push({ webhook_id: id, url: String(body?.url), events: body?.events as string[] });
      return Promise.resolve(jsonResponse(200, Number(id)));
    }
    if (method === 'PUT' && path.startsWith('/webhooks/')) {
      return Promise.resolve(jsonResponse(200, 1));
    }
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });

  const connectionPort = {
    get: jest.fn().mockResolvedValue({
      id: CONNECTION_ID,
      platformType: 'shoper',
      credentialsRef: 'db:cred-1',
      enabledCapabilities: options.enabledCapabilities ?? ['ProductMaster', 'OrderSource'],
      config: {
        baseUrl: 'sklep729770.shoparena.pl',
        openlinkerCallbackBaseUrl: CALLBACK,
        ...options.config,
      },
    }),
    update: jest.fn().mockResolvedValue(undefined),
  } as unknown as Fixture['connectionPort'];
  const secretService = { rotate: jest.fn().mockResolvedValue({ secret: SECRET }) } as unknown as Fixture['secretService'];
  const credentialsResolver = { get: jest.fn().mockResolvedValue({ token: 'api-token' }) } as unknown as CredentialsResolverPort;
  const http = { forConnection: jest.fn().mockReturnValue(fetchMock) } as unknown as HttpTransportFactoryPort;

  return {
    adapter: new ShoperWebhookProvisioningAdapter(
      connectionPort as unknown as ConnectionPort,
      secretService as unknown as IWebhookSecretService,
      credentialsResolver,
      http,
    ),
    connectionPort,
    secretService,
    fetchMock,
    calls,
    shop,
  };
}

describe('ShoperWebhookProvisioningAdapter', () => {
  describe('refusals (nothing is rotated and nothing reaches the shop)', () => {
    it('should refuse when OrderSource is not enabled, because every delivery would be accepted and then discarded', async () => {
      const f = setup({ enabledCapabilities: ['ProductMaster', 'InventoryMaster'] });

      await expect(f.adapter.install(CONNECTION_ID)).rejects.toThrow(/Enable the Order source capability/);

      expect(f.secretService.rotate).not.toHaveBeenCalled();
      expect(f.fetchMock).not.toHaveBeenCalled();
    });

    it.each([[undefined], [''], ['   '], [null]])('should refuse without a callback URL (%p), naming the remedy', async (value) => {
      const f = setup({ config: { openlinkerCallbackBaseUrl: value } });

      const error = await f.adapter.install(CONNECTION_ID).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toMatch(/callback URL/);
      expect(f.secretService.rotate).not.toHaveBeenCalled();
      expect(f.fetchMock).not.toHaveBeenCalled();
    });

    it('should refuse an unusable baseUrl', async () => {
      const f = setup({ config: { baseUrl: 'localhost' } });

      await expect(f.adapter.install(CONNECTION_ID)).rejects.toBeInstanceOf(BadRequestException);
      expect(f.secretService.rotate).not.toHaveBeenCalled();
    });
  });

  describe('first install', () => {
    it('should rotate the secret for provider shoper and attribute it to the actor', async () => {
      const f = setup();

      await f.adapter.install(CONNECTION_ID, 'user-7');

      expect(f.secretService.rotate).toHaveBeenCalledWith('shoper', CONNECTION_ID, 'user-7');
    });

    it('should register ONE webhook with every order event, active, whose URL carries the encoded token', async () => {
      const f = setup();

      await f.adapter.install(CONNECTION_ID);

      const posts = f.calls.filter((c) => c.method === 'POST');
      expect(posts).toHaveLength(1);
      expect(posts[0]?.path).toBe('/webhooks');
      expect(posts[0]?.body).toEqual({
        url: `${ENDPOINT}?token=${ENCODED_SECRET}`,
        events: ['order.create', 'order.edit', 'order.paid', 'order.status'],
        active: 1,
        format: 0,
        secret: SECRET,
      });
    });

    it('should never register order.delete, whose re-read would 404 and retry for nothing', async () => {
      const f = setup();

      await f.adapter.install(CONNECTION_ID);

      expect(JSON.stringify(f.calls.find((c) => c.method === 'POST')?.body)).not.toContain('order.delete');
    });

    it('should normalise a trailing slash on the callback URL', async () => {
      const f = setup({ config: { openlinkerCallbackBaseUrl: `${CALLBACK}///` } });

      await f.adapter.install(CONNECTION_ID);

      expect(String(f.calls.find((c) => c.method === 'POST')?.body?.url)).toMatch(
        new RegExp(`^${ENDPOINT.replace(/[.]/g, '\\.')}\\?token=`),
      );
    });

    it('should record the success on the connection, keeping the rest of its config, and report no ping', async () => {
      const f = setup();

      const result = await f.adapter.install(CONNECTION_ID);

      expect(f.connectionPort.update).toHaveBeenCalledWith(CONNECTION_ID, {
        config: {
          baseUrl: 'sklep729770.shoparena.pl',
          openlinkerCallbackBaseUrl: CALLBACK,
          webhooksConfigured: true,
        },
      });
      expect(result).toEqual({ webhooksConfigured: true, testPingTriggered: false });
    });
  });

  describe('idempotency', () => {
    it('should PUT the webhook already pointing at our endpoint even though its token differs, never POST a second one', async () => {
      const f = setup({
        shopWebhooks: [{ webhook_id: '9', url: `${ENDPOINT}?token=OLD-TOKEN`, events: ['order.create'] }],
      });

      await f.adapter.install(CONNECTION_ID);

      expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
      const puts = f.calls.filter((c) => c.method === 'PUT');
      expect(puts).toHaveLength(1);
      expect(puts[0]?.path).toBe('/webhooks/9');
      expect(puts[0]?.body).toMatchObject({ url: `${ENDPOINT}?token=${ENCODED_SECRET}`, active: 1 });
    });

    it('should leave every other webhook of the shop alone', async () => {
      const f = setup({
        shopWebhooks: [
          { webhook_id: '3', url: 'https://appstore-bridge.example.com/hook' },
          { webhook_id: '5', url: 'https://webhook.site/abc' },
        ],
      });

      await f.adapter.install(CONNECTION_ID);

      expect(f.calls.filter((c) => c.method === 'PUT' || c.method === 'DELETE')).toHaveLength(0);
      expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    });

    it('should not mistake another connection of the same OpenLinker for ours', async () => {
      const f = setup({
        shopWebhooks: [{ webhook_id: '4', url: `${CALLBACK}/webhooks/shoper/99999999-0000-0000-0000-000000000000?token=x` }],
      });

      await f.adapter.install(CONNECTION_ID);

      expect(f.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
      expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    });

    it('should find ours on a later page of the shop webhooks', async () => {
      const others = Array.from({ length: 4 }, (_v, i) => ({ webhook_id: String(i + 1), url: `https://other.example.com/${i}` }));
      const f = setup({
        shopWebhooks: [...others, { webhook_id: '8', url: `${ENDPOINT}?token=OLD` }],
        pageSize: 2,
      });

      await f.adapter.install(CONNECTION_ID);

      expect(f.calls.filter((c) => c.method === 'PUT').map((c) => c.path)).toEqual(['/webhooks/8']);
      expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    });

    it('should update every duplicate, so none keeps the rotated-out token, and delete none', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const f = setup({
        shopWebhooks: [
          { webhook_id: '6', url: `${ENDPOINT}?token=A` },
          { webhook_id: '7', url: `${ENDPOINT}?token=B` },
        ],
      });

      await f.adapter.install(CONNECTION_ID);

      expect(f.calls.filter((c) => c.method === 'PUT').map((c) => c.path)).toEqual(['/webhooks/6', '/webhooks/7']);
      expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
      expect(f.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('2 webhooks'));
      warn.mockRestore();
    });
  });

  describe('failure', () => {
    function echoedUrlFailure(body: Record<string, unknown>): Response {
      return jsonResponse(400, {
        error: 'invalid_request',
        error_description: `Wartość pola 'url' jest niepoprawna: '${String(body.url)}' nie jest poprawnym adresem URL`,
      });
    }

    it('should never leak the token, even though Shoper echoes the rejected URL in its error', async () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const f = setup({ failWrite: (method, body) => (method === 'POST' ? echoedUrlFailure(body) : null) });

      const thrown = await f.adapter.install(CONNECTION_ID).catch((e: unknown) => e);

      expect(thrown).toBeInstanceOf(BadRequestException);
      const surfaced = [
        (thrown as Error).message,
        JSON.stringify((thrown as BadRequestException).getResponse()),
        JSON.stringify(error.mock.calls),
      ].join('\n');
      expect(surfaced).not.toContain(SECRET);
      expect(surfaced).not.toContain(ENCODED_SECRET);
      expect(surfaced).toContain('[redacted]');
      error.mockRestore();
    });

    it('should fail closed: flag the connection unconfigured and say re-running is safe', async () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const f = setup({ failWrite: (method, body) => (method === 'POST' ? echoedUrlFailure(body) : null) });

      await expect(f.adapter.install(CONNECTION_ID)).rejects.toThrow(/re-running install is safe/);

      expect(f.connectionPort.update).toHaveBeenCalledWith(CONNECTION_ID, {
        config: expect.objectContaining({ webhooksConfigured: false }),
      });
      error.mockRestore();
    });

    it('should report webhooksConfigured false with a warning when only the state write fails', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const f = setup();
      f.connectionPort.update.mockRejectedValue(new Error('db down'));

      const result = await f.adapter.install(CONNECTION_ID);

      expect(result).toEqual({ webhooksConfigured: false, testPingTriggered: false, warning: 'state-update-failed' });
      expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
      warn.mockRestore();
    });
  });
});

describe('redactSecret', () => {
  it('should replace the raw and the URL-encoded secret everywhere', () => {
    expect(redactSecret(`bad '${SECRET}' and ?token=${ENCODED_SECRET}`, SECRET)).toBe(
      "bad '[redacted]' and ?token=[redacted]",
    );
  });

  it('should leave a message without the secret untouched, and survive an empty secret', () => {
    expect(redactSecret('plain', SECRET)).toBe('plain');
    expect(redactSecret('plain', '')).toBe('plain');
  });
});
