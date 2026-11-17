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
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { CachePort } from '@openlinker/shared';
import type { FetchLike } from '@openlinker/shared/http';

import { AmazonConfigException } from '../domain/exceptions/amazon-config.exception';
import { parseAmazonConfig, resolveAmazonSpApiHost } from '../domain/policies/amazon-config.policy';
import { parseAmazonCredentials } from '../domain/policies/amazon-credentials.policy';
import { AmazonAccessTokenProvider } from '../infrastructure/http/amazon-access-token.provider';
import { AmazonSpApiClient } from '../infrastructure/http/amazon-spapi-client';
import { AmazonSqsClient } from '../infrastructure/http/amazon-sqs-client';
import { AmazonOrderSourceAdapter } from '../infrastructure/adapters/order-source/amazon-order-source.adapter';
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
      client: new AmazonSpApiClient(resolveAmazonSpApiHost(config.config), tokens, fetchImpl),
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

  createOrderSource(resolution: AmazonResolution): AmazonOrderSourceAdapter {
    return new AmazonOrderSourceAdapter(
      resolution.connection.id,
      resolution.client,
      resolution.config,
      undefined,
      resolution.notificationQueue,
    );
  }
}
