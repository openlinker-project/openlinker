import { BadRequestException } from '@nestjs/common';
import type { Connection, ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort, IWebhookSecretService } from '@openlinker/core/integrations';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';

import { createShopifyClientRuntime } from '../../../http/shopify-client.builder';
import {
  planShopifyWebhooks,
  ShopifyWebhookProvisioningAdapter,
  shopifyWebhookTopicsFor,
} from '../shopify-webhook-provisioning.adapter';

const URI = 'https://ol.example.com/webhooks/shopify/conn-1';
const PATH = '/webhooks/shopify/conn-1';

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    platformType: 'shopify',
    status: 'active',
    enabledCapabilities: ['OrderSource', 'ProductMaster'],
    config: { storeDomain: 'my-shop.myshopify.com', openlinkerCallbackBaseUrl: 'https://ol.example.com/' },
    credentialsRef: 'db:cred-1',
    ...overrides,
  } as unknown as Connection;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

const listed = (nodes: unknown[]): Response =>
  json({ data: { webhookSubscriptions: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } });
const created = (): Response =>
  json({ data: { webhookSubscriptionCreate: { webhookSubscription: { id: 'x' }, userErrors: [] } } });
const deleted = (): Response =>
  json({ data: { webhookSubscriptionDelete: { deletedWebhookSubscriptionId: 'x', userErrors: [] } } });

interface Harness {
  readonly adapter: ShopifyWebhookProvisioningAdapter;
  readonly fetchImpl: jest.Mock;
  readonly connections: { get: jest.Mock; update: jest.Mock };
  readonly secrets: { set: jest.Mock };
}

function build(conn: Connection, credentials: unknown = { accessToken: 'shpat_x', clientId: 'id', clientSecret: 'cs' }): Harness {
  const fetchImpl = jest.fn();
  const connections = { get: jest.fn().mockResolvedValue(conn), update: jest.fn().mockResolvedValue(undefined) };
  const secrets = { set: jest.fn().mockResolvedValue(undefined) };
  const adapter = new ShopifyWebhookProvisioningAdapter(
    connections as unknown as ConnectionPort,
    secrets as unknown as IWebhookSecretService,
    { get: jest.fn().mockResolvedValue(credentials) } as unknown as CredentialsResolverPort,
    { forConnection: jest.fn().mockReturnValue(fetchImpl) } as unknown as HttpTransportFactoryPort,
    createShopifyClientRuntime(),
  );
  return { adapter, fetchImpl, connections, secrets };
}

function requestBody(call: unknown[]): { query: string; variables: Record<string, unknown> } {
  const init = call[1] as RequestInit;
  return JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
}

describe('shopifyWebhookTopicsFor', () => {
  it('should follow the enabled capabilities, orders first', () => {
    expect(shopifyWebhookTopicsFor(['ProductMaster', 'OrderSource'])).toEqual([
      'ORDERS_CREATE',
      'ORDERS_UPDATED',
      'ORDERS_CANCELLED',
      'PRODUCTS_CREATE',
      'PRODUCTS_UPDATE',
      'PRODUCTS_DELETE',
    ]);
    expect(shopifyWebhookTopicsFor(['InventoryMaster'])).toEqual([]);
  });
});

describe('planShopifyWebhooks', () => {
  it('should keep current subscriptions, create the missing ones and leave foreign ones alone', () => {
    const plan = planShopifyWebhooks(
      [
        { id: 'a', topic: 'ORDERS_CREATE', uri: `${URI}/` },
        { id: 'b', topic: 'ORDERS_CREATE', uri: 'https://other.example.com/hook' },
        { id: 'c', topic: 'ORDERS_UPDATED', uri: 'https://ol.example.com/webhooks/shopify/conn-2' },
      ],
      ['ORDERS_CREATE', 'ORDERS_UPDATED'],
      URI,
      PATH,
    );

    expect(plan).toEqual({ toCreate: ['ORDERS_UPDATED'], toDelete: [] });
  });

  it('should replace ours on an old host and drop a topic no capability needs any more', () => {
    const plan = planShopifyWebhooks(
      [
        { id: 'old', topic: 'ORDERS_CREATE', uri: `https://old.example.com${PATH}` },
        { id: 'stale', topic: 'PRODUCTS_UPDATE', uri: URI },
      ],
      ['ORDERS_CREATE'],
      URI,
      PATH,
    );

    expect(plan.toCreate).toEqual(['ORDERS_CREATE']);
    expect(plan.toDelete.map((node) => node.id)).toEqual(['old', 'stale']);
  });
});

describe('ShopifyWebhookProvisioningAdapter', () => {
  it('should store the client secret, subscribe the missing topics and delete stale ones after', async () => {
    const h = build(connection({ enabledCapabilities: ['OrderSource'] } as Partial<Connection>));
    h.fetchImpl
      .mockResolvedValueOnce(
        listed([
          { id: 'keep', topic: 'ORDERS_CREATE', uri: URI },
          { id: 'old', topic: 'ORDERS_UPDATED', uri: `https://old.example.com${PATH}` },
        ]),
      )
      .mockResolvedValueOnce(created())
      .mockResolvedValueOnce(created())
      .mockResolvedValueOnce(deleted());

    await expect(h.adapter.install('conn-1', 'user-1')).resolves.toEqual({
      webhooksConfigured: true,
      testPingTriggered: false,
    });

    expect(h.secrets.set).toHaveBeenCalledWith('shopify', 'conn-1', 'cs', 'user-1');
    const sent = h.fetchImpl.mock.calls.map((call: unknown[]) => requestBody(call));
    expect(sent[1].variables).toEqual({ topic: 'ORDERS_UPDATED', webhookSubscription: { uri: URI, format: 'JSON' } });
    expect(sent[2].variables).toMatchObject({ topic: 'ORDERS_CANCELLED' });
    expect(sent[3].variables).toEqual({ id: 'old' });
    expect(h.connections.update).toHaveBeenCalledWith('conn-1', {
      config: expect.objectContaining({ webhooksConfigured: true }),
    });
  });

  it('should refuse a connection with neither orders nor products enabled', async () => {
    const h = build(connection({ enabledCapabilities: ['InventoryMaster'] } as Partial<Connection>));

    await expect(h.adapter.install('conn-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(h.secrets.set).not.toHaveBeenCalled();
  });

  it('should refuse a connection without a callback URL', async () => {
    const h = build(connection({ config: { storeDomain: 'my-shop.myshopify.com' } } as Partial<Connection>));

    await expect(h.adapter.install('conn-1')).rejects.toThrow(/callback URL/);
  });

  it('should refuse an access-token-only connection, which has no secret to verify with', async () => {
    const h = build(connection(), { accessToken: 'shpat_x' });

    await expect(h.adapter.install('conn-1')).rejects.toThrow(/client secret/);
    expect(h.secrets.set).not.toHaveBeenCalled();
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it('should flag the connection unconfigured and answer 400 when Shopify refuses', async () => {
    const h = build(connection());
    h.fetchImpl
      .mockResolvedValueOnce(listed([]))
      .mockResolvedValueOnce(
        json({
          data: {
            webhookSubscriptionCreate: { webhookSubscription: null, userErrors: [{ field: ['uri'], message: 'bad' }] },
          },
        }),
      );

    await expect(h.adapter.install('conn-1')).rejects.toThrow(/Re-running install is safe/);
    expect(h.connections.update).toHaveBeenCalledWith('conn-1', {
      config: expect.objectContaining({ webhooksConfigured: false }),
    });
  });

  it('should report a failed state update as a warning, not a failure', async () => {
    const h = build(connection({ enabledCapabilities: ['OrderSource'] } as Partial<Connection>));
    h.fetchImpl.mockResolvedValueOnce(
      listed([
        { id: '1', topic: 'ORDERS_CREATE', uri: URI },
        { id: '2', topic: 'ORDERS_UPDATED', uri: URI },
        { id: '3', topic: 'ORDERS_CANCELLED', uri: URI },
      ]),
    );
    h.connections.update.mockRejectedValueOnce(new Error('db down'));

    await expect(h.adapter.install('conn-1')).resolves.toEqual({
      webhooksConfigured: false,
      testPingTriggered: false,
      warning: 'state-update-failed',
    });
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  });
});
