/**
 * Shopify Webhook Provisioning Adapter (#3981)
 *
 * Implements `WebhookProvisioningPort` for Shopify: subscribes the shop to the
 * order and product topics OpenLinker routes, delivering to
 * `${openlinkerCallbackBaseUrl}/webhooks/shopify/${connectionId}`. Registered
 * by `ShopifyIntegrationModule` (it needs `ConnectionPort` and
 * `IWebhookSecretService`, which `HostServices` does not carry) and reached
 * through `POST /connections/:id/webhooks/install`.
 *
 * THE SECRET IS SHOPIFY'S, NOT OURS: Shopify signs every delivery with the
 * app's client secret and offers no per-subscription key, so instead of
 * rotating a fresh secret (the Shoper posture) the provisioner stores the
 * client secret as the connection's webhook secret. That needs the manifest's
 * `acceptsCallerSuppliedWebhookSecret: true` (the inFakt precedent). A
 * connection holding only a pre-issued access token has no client secret to
 * verify with and is refused. The delivery URI carries no credential.
 *
 * ONE CLIENT RUNTIME: the GraphQL client is built with the plugin's own runtime
 * (token memo, credentials writer, lock), so an OAuth refresh that happens
 * during an install writes the rotated refresh token back, exactly as a job's
 * would. A private memo would refresh without saving and break the connection.
 *
 * IDEMPOTENT: a subscription is ours when its uri is our delivery path for this
 * connection. A topic already subscribed to the current uri is left alone, a
 * missing one is created, and one of ours that points at an old callback base
 * or at a topic no enabled capability needs any more is deleted AFTER the new
 * ones exist, so a base-URL move leaves no window without deliveries.
 * Subscriptions that are not ours (another app path, another connection) are
 * never touched.
 *
 * TOPICS FOLLOW THE ENABLED CAPABILITIES: order topics for `OrderSource`,
 * product topics for `ProductMaster`; the routing gate would otherwise accept
 * and then dead-letter every delivery of the other kind. Neither enabled is
 * refused. The orders poll stays on as the reconciliation backstop (#904).
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/webhooks
 * @implements {WebhookProvisioningPort}
 */
import { BadRequestException } from '@nestjs/common';
import type { Connection, ConnectionPort } from '@openlinker/core/identifier-mapping';
import type {
  CredentialsResolverPort,
  IWebhookSecretService,
  WebhookProvisioningPort,
  WebhookProvisioningResult,
} from '@openlinker/core/integrations';
import type { CachePort } from '@openlinker/shared';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';
import { Logger } from '@openlinker/shared/logging';
import type { ConnectionRateLimit } from '@openlinker/shared/rate-limit';

import { resolveShopifyRateLimitBucketKey } from '../../../domain/policies/shopify-rate-limit-bucket.policy';
import type { ShopifyCredentials } from '../../../domain/types/shopify-credentials.types';
import {
  SHOPIFY_ORDER_WEBHOOK_TOPICS,
  SHOPIFY_PRODUCT_WEBHOOK_TOPICS,
  SHOPIFY_WEBHOOK_PROVIDER,
  SHOPIFY_WEBHOOK_TOPIC_ENUM,
  type ShopifyWebhookSubscriptionNode,
} from '../../../domain/types/shopify-webhook.types';
import { buildShopifyClient, type ShopifyClientRuntime } from '../../http/shopify-client.builder';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';

/** The capability the routing gate requires for an `order` delivery. */
const ORDER_CAPABILITY = 'OrderSource';

/** The capability the routing gate requires for a `product` delivery. */
const PRODUCT_CAPABILITY = 'ProductMaster';

const SUBSCRIPTIONS_PAGE_SIZE = 100;

const LIST_SUBSCRIPTIONS = `
  query ShopifyWebhookSubscriptions($first: Int!, $after: String) {
    webhookSubscriptions(first: $first, after: $after) {
      nodes { id topic uri }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const CREATE_SUBSCRIPTION = `
  mutation ShopifyWebhookSubscriptionCreate(
    $topic: WebhookSubscriptionTopic!
    $webhookSubscription: WebhookSubscriptionInput!
  ) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id topic uri }
      userErrors { field message }
    }
  }
`;

const DELETE_SUBSCRIPTION = `
  mutation ShopifyWebhookSubscriptionDelete($id: ID!) {
    webhookSubscriptionDelete(id: $id) {
      deletedWebhookSubscriptionId
      userErrors { field message }
    }
  }
`;

interface ListSubscriptionsData {
  readonly webhookSubscriptions: {
    readonly nodes: readonly ShopifyWebhookSubscriptionNode[];
    readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
  };
}

/** `WebhookSubscriptionTopic` values for the capabilities the connection enables, orders first. */
export function shopifyWebhookTopicsFor(enabledCapabilities: readonly string[]): string[] {
  return [
    ...(enabledCapabilities.includes(ORDER_CAPABILITY) ? SHOPIFY_ORDER_WEBHOOK_TOPICS : []),
    ...(enabledCapabilities.includes(PRODUCT_CAPABILITY) ? SHOPIFY_PRODUCT_WEBHOOK_TOPICS : []),
  ].map((topic) => SHOPIFY_WEBHOOK_TOPIC_ENUM[topic]);
}

export interface ShopifyWebhookPlan {
  readonly toCreate: readonly string[];
  readonly toDelete: readonly ShopifyWebhookSubscriptionNode[];
}

/**
 * Pure diff of the shop's subscriptions against what this connection needs.
 * `endpointPath` is `/webhooks/shopify/{connectionId}`: a subscription whose
 * uri ends with it is ours, whatever host it names.
 */
export function planShopifyWebhooks(
  existing: readonly ShopifyWebhookSubscriptionNode[],
  desiredTopics: readonly string[],
  deliveryUri: string,
  endpointPath: string,
): ShopifyWebhookPlan {
  const ours = existing.filter((node) => normaliseUri(node.uri).endsWith(endpointPath));
  const isCurrent = (node: ShopifyWebhookSubscriptionNode): boolean =>
    normaliseUri(node.uri) === deliveryUri && desiredTopics.includes(node.topic);
  const kept = new Set(ours.filter(isCurrent).map((node) => node.topic));
  return {
    toCreate: desiredTopics.filter((topic) => !kept.has(topic)),
    toDelete: ours.filter((node) => !isCurrent(node)),
  };
}

function normaliseUri(uri: string | null): string {
  return typeof uri === 'string' ? (uri.trim().split('?')[0] ?? '').replace(/\/+$/, '') : '';
}

export class ShopifyWebhookProvisioningAdapter implements WebhookProvisioningPort {
  private readonly logger = new Logger(ShopifyWebhookProvisioningAdapter.name);

  constructor(
    private readonly connectionPort: ConnectionPort,
    private readonly webhookSecretService: IWebhookSecretService,
    private readonly credentialsResolver: CredentialsResolverPort,
    private readonly http: HttpTransportFactoryPort,
    private readonly runtime: ShopifyClientRuntime,
    private readonly cache?: CachePort,
    private readonly defaultRateLimit?: ConnectionRateLimit,
  ) {}

  async install(connectionId: string, actorUserId?: string): Promise<WebhookProvisioningResult> {
    const connection = await this.connectionPort.get(connectionId);

    const topics = shopifyWebhookTopicsFor(connection.enabledCapabilities);
    if (topics.length === 0) {
      throw new BadRequestException(
        'Enable the Order source or Product master capability on this connection before ' +
          'configuring webhooks: without one OpenLinker would accept every Shopify delivery and ' +
          'then discard it.',
      );
    }

    const config = (connection.config ?? {}) as Record<string, unknown>;
    const callbackBaseUrl =
      typeof config.openlinkerCallbackBaseUrl === 'string' ? config.openlinkerCallbackBaseUrl.trim() : '';
    if (callbackBaseUrl.length === 0) {
      throw new BadRequestException(
        'Set the OpenLinker callback URL on this connection before configuring webhooks. ' +
          'Shopify needs a public https URL of OpenLinker to send events to.',
      );
    }
    if (!connection.credentialsRef) {
      throw new BadRequestException(`Connection ${connectionId} has no stored credentials.`);
    }
    const credentials = await this.credentialsResolver.get<ShopifyCredentials>(connection.credentialsRef);
    const clientSecret = typeof credentials.clientSecret === 'string' ? credentials.clientSecret.trim() : '';
    if (clientSecret.length === 0) {
      throw new BadRequestException(
        'Shopify signs webhooks with the app client secret, and this connection stores only an ' +
          'access token. Add the app client id and client secret to the connection credentials, ' +
          'then configure webhooks again.',
      );
    }

    const endpointPath = `/webhooks/${SHOPIFY_WEBHOOK_PROVIDER}/${connectionId}`;
    const deliveryUri = `${callbackBaseUrl.replace(/\/+$/, '')}${endpointPath}`;

    let plan: ShopifyWebhookPlan;
    try {
      // Stored before subscribing, so the first delivery can already be verified.
      await this.webhookSecretService.set(SHOPIFY_WEBHOOK_PROVIDER, connectionId, clientSecret, actorUserId);

      const { client } = await buildShopifyClient(
        connection,
        this.credentialsResolver,
        this.http.forConnection(connection, this.defaultRateLimit, {
          bucketKey: resolveShopifyRateLimitBucketKey(connection),
        }),
        this.cache,
        this.runtime,
      );
      plan = planShopifyWebhooks(await this.listSubscriptions(client), topics, deliveryUri, endpointPath);
      for (const topic of plan.toCreate) {
        await client.mutate(
          CREATE_SUBSCRIPTION,
          { topic, webhookSubscription: { uri: deliveryUri, format: 'JSON' } },
          'webhookSubscriptionCreate',
        );
      }
      for (const node of plan.toDelete) {
        await client.mutate(DELETE_SUBSCRIPTION, { id: node.id }, 'webhookSubscriptionDelete');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to register Shopify webhooks for connection ${connectionId}: ${message}`);
      await this.markWebhooksConfigured(connectionId, connection.config, false);
      throw new BadRequestException(
        `Shopify webhook registration failed: ${message}. Re-running install is safe (it is idempotent).`,
      );
    }

    const stateUpdateOk = await this.markWebhooksConfigured(connectionId, connection.config, true);
    this.logger.log(
      `webhook_install.completed connectionId=${connectionId} provider=${SHOPIFY_WEBHOOK_PROVIDER} ` +
        `topics=${topics.join(',')} created=${plan.toCreate.length} deleted=${plan.toDelete.length} ` +
        `webhooksConfigured=${stateUpdateOk} actor=${actorUserId ?? 'system'}`,
    );
    // Shopify has no synchronous test ping through the Admin API.
    return {
      webhooksConfigured: stateUpdateOk,
      testPingTriggered: false,
      ...(stateUpdateOk ? {} : { warning: 'state-update-failed' }),
    };
  }

  private async listSubscriptions(client: ShopifyGraphqlClient): Promise<ShopifyWebhookSubscriptionNode[]> {
    const nodes: ShopifyWebhookSubscriptionNode[] = [];
    let after: string | null = null;
    for (;;) {
      const data: ListSubscriptionsData = await client.query<ListSubscriptionsData>(LIST_SUBSCRIPTIONS, {
        first: SUBSCRIPTIONS_PAGE_SIZE,
        after,
      });
      nodes.push(...data.webhookSubscriptions.nodes);
      const { hasNextPage, endCursor } = data.webhookSubscriptions.pageInfo;
      if (!hasNextPage || endCursor === null) {
        return nodes;
      }
      after = endCursor;
    }
  }

  /** Never throws: the shop side is already done (or already failed) when this runs. */
  private async markWebhooksConfigured(
    connectionId: string,
    config: Connection['config'],
    value: boolean,
  ): Promise<boolean> {
    try {
      await this.connectionPort.update(connectionId, { config: { ...config, webhooksConfigured: value } });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not set webhooksConfigured=${value} on connection ${connectionId}: ${message}. ` +
          'Re-running install is idempotent.',
      );
      return false;
    }
  }
}
