/**
 * Amazon Adapter Factory
 *
 * Per-connection resolution for the Amazon plugin: reads and checks the
 * connection's config and stored credentials, and builds ONE SP-API client
 * over the connection-bound transport. Credentials are resolved per call -
 * never in a constructor, never cached across connections; only the access
 * token they mint is cached (by fingerprint, see `AmazonAccessTokenProvider`).
 *
 * Capability adapters are built on top of `AmazonResolution`, one `create*`
 * method each, added by the issue that delivers the capability.
 *
 * @module libs/integrations/amazon/src/application
 */
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { CachePort } from '@openlinker/shared';
import type { FetchLike } from '@openlinker/shared/http';

import { AMAZON_NOTIFICATIONS_GRANTLESS_SCOPE } from '../amazon.constants';
import { AmazonConfigException } from '../domain/exceptions/amazon-config.exception';
import { parseAmazonConfig, resolveAmazonSpApiHost } from '../domain/policies/amazon-config.policy';
import { parseAmazonCredentials } from '../domain/policies/amazon-credentials.policy';
import { AmazonAccessTokenProvider } from '../infrastructure/http/amazon-access-token.provider';
import { AmazonSpApiClient } from '../infrastructure/http/amazon-spapi-client';
import { AmazonSqsClient } from '../infrastructure/http/amazon-sqs-client';
import { AmazonInventoryMasterAdapter } from '../infrastructure/adapters/inventory-master/amazon-inventory-master.adapter';
import { AmazonOfferManagerAdapter } from '../infrastructure/adapters/offer-manager/amazon-offer-manager.adapter';
import { AmazonProductMasterAdapter } from '../infrastructure/adapters/product-master/amazon-product-master.adapter';
import { AmazonOrderSourceAdapter } from '../infrastructure/adapters/order-source/amazon-order-source.adapter';
import { AmazonQueuedOrderSourceAdapter } from '../infrastructure/adapters/order-source/amazon-queued-order-source.adapter';
import {
  AmazonQueuedRefundingOrderSourceAdapter,
  AmazonRefundingOrderSourceAdapter,
} from '../infrastructure/adapters/order-source/amazon-refunding-order-source.adapter';
import { AmazonRefundExecutor } from '../infrastructure/adapters/returns/amazon-refund-executor';
import { AmazonReturnReader } from '../infrastructure/adapters/returns/amazon-return-reader';
import { AmazonFeedsClient } from '../infrastructure/http/amazon-feeds.client';
import { AmazonFulfillmentOutboundClient } from '../infrastructure/http/amazon-fulfillment-outbound.client';
import { AmazonMcfFulfillmentExecutorAdapter } from '../infrastructure/adapters/fulfillment-executor/amazon-mcf-fulfillment-executor.adapter';
import { AmazonReportsClient } from '../infrastructure/http/amazon-reports.client';
import type { AmazonResolution, IAmazonAdapterFactory } from './interfaces/amazon-adapter.factory.interface';

export class AmazonAdapterFactory implements IAmazonAdapterFactory {
  async resolve(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    fetchImpl: FetchLike,
    cache?: CachePort,
  ): Promise<AmazonResolution> {
    const config = parseAmazonConfig(connection.config ?? {});
    if (!config.ok) {
      throw new AmazonConfigException(
        connection.id,
        config.issues.map((issue) => `${issue.path} ${issue.message}`).join('; '),
      );
    }
    if (!connection.credentialsRef) {
      throw new AmazonConfigException(connection.id, 'no stored credentials');
    }

    const stored = await credentialsResolver.get<Record<string, unknown>>(connection.credentialsRef);
    const credentials = parseAmazonCredentials(stored);
    if (!credentials.ok) {
      throw new AmazonConfigException(connection.id, `stored credentials ${credentials.issues.join('; ')}`);
    }

    const tokens = new AmazonAccessTokenProvider(credentials.credentials, fetchImpl, cache);
    const queue = config.config.notificationQueue;
    const { awsAccessKeyId, awsSecretAccessKey } = credentials.credentials;
    return {
      connection,
      config: config.config,
      credentialSource: credentials.source,
      fetchImpl,
      ...(cache ? { cache } : {}),
      client: new AmazonSpApiClient(resolveAmazonSpApiHost(config.config), tokens, fetchImpl),
      notificationsClient: new AmazonSpApiClient(
        resolveAmazonSpApiHost(config.config),
        new AmazonAccessTokenProvider(credentials.credentials, fetchImpl, cache, undefined, undefined, undefined, {
          scope: AMAZON_NOTIFICATIONS_GRANTLESS_SCOPE,
        }),
        fetchImpl,
      ),
      ...(queue && awsAccessKeyId && awsSecretAccessKey
        ? {
            notificationQueue: new AmazonSqsClient(
              queue,
              { accessKeyId: awsAccessKeyId, secretAccessKey: awsSecretAccessKey },
              fetchImpl,
            ),
          }
        : {}),
    };
  }

  /**
   * The order source, with the returns report reader (#4184). The queue
   * reader (#4179) is there only when the connection has a notification queue
   * and its AWS key: without one, `isInboundQueueReader` answers no and the
   * drain handler reports a configuration fact. A connection that opted in to
   * refunds gets the subclass that is also a `RefundExecutor`.
   */
  createOrderSource(resolution: AmazonResolution, cache?: CachePort): AmazonOrderSourceAdapter {
    const { connection, client, config, notificationQueue, fetchImpl } = resolution;
    const returns = new AmazonReturnReader(
      new AmazonReportsClient(client, fetchImpl),
      connection.id,
      config.marketplaceIds,
      cache,
    );
    if (config.refundsEnabled !== true) {
      return notificationQueue === undefined
        ? new AmazonOrderSourceAdapter(connection.id, client, config, undefined, returns)
        : new AmazonQueuedOrderSourceAdapter(connection.id, client, config, notificationQueue, undefined, returns);
    }
    const source =
      notificationQueue === undefined
        ? new AmazonRefundingOrderSourceAdapter(connection.id, client, config, undefined, returns)
        : new AmazonQueuedRefundingOrderSourceAdapter(
            connection.id,
            client,
            config,
            notificationQueue,
            undefined,
            returns,
          );
    return source.attachRefundExecutor(
      (readOrder) =>
        new AmazonRefundExecutor({
          connectionId: connection.id,
          marketplaceIds: config.marketplaceIds,
          feeds: new AmazonFeedsClient(client, fetchImpl),
          returns,
          readOrder,
          cache,
        }),
    );
  }

  createOfferManager(resolution: AmazonResolution): AmazonOfferManagerAdapter {
    return new AmazonOfferManagerAdapter(
      resolution.connection.id,
      resolution.client,
      resolution.config,
      resolution.fetchImpl,
      resolution.cache,
      // A stock-master connection gets no quantity written back to its own listings (#4183).
      resolution.connection.enabledCapabilities.includes('InventoryMaster'),
    );
  }

  createProductMaster(
    resolution: AmazonResolution,
    identifierMapping: IdentifierMappingPort,
    cache?: CachePort,
  ): AmazonProductMasterAdapter {
    return new AmazonProductMasterAdapter(
      resolution.connection,
      resolution.client,
      resolution.config,
      identifierMapping,
      cache,
    );
  }

  createInventoryMaster(
    resolution: AmazonResolution,
    identifierMapping: IdentifierMappingPort,
    cache?: CachePort,
  ): AmazonInventoryMasterAdapter {
    return new AmazonInventoryMasterAdapter(
      resolution.connection,
      resolution.client,
      resolution.config,
      identifierMapping,
      cache,
    );
  }

  /** Amazon Multi-Channel Fulfillment as a fulfilment holder (#4185). */
  createFulfillmentExecutor(
    resolution: AmazonResolution,
    identifierMapping: IdentifierMappingPort,
    cache?: CachePort,
  ): AmazonMcfFulfillmentExecutorAdapter {
    return new AmazonMcfFulfillmentExecutorAdapter(
      new AmazonFulfillmentOutboundClient(resolution.client),
      identifierMapping,
      {
        connectionId: resolution.connection.id,
        marketplaceId: resolution.config.marketplaceIds[0],
        shippingSpeed: resolution.config.mcfShippingSpeed ?? 'Standard',
      },
      cache,
    );
  }
}
