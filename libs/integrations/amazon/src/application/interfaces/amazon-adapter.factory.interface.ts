/**
 * Amazon Adapter Factory Interface
 *
 * The resolution seam the connection tester (and, later, the capability
 * adapters) depend on, so the infrastructure -> application edge is against an
 * interface and tests can substitute it.
 *
 * @module libs/integrations/amazon/src/application/interfaces
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { CachePort } from '@openlinker/shared';
import type { FetchLike } from '@openlinker/shared/http';

import type { AmazonConnectionConfig } from '../../domain/types/amazon-config.types';
import type { AmazonCredentialSource } from '../../domain/types/amazon-credentials.types';
import type { AmazonSpApiClient } from '../../infrastructure/http/amazon-spapi-client';
import type { AmazonSqsClient } from '../../infrastructure/http/amazon-sqs-client';

export interface AmazonResolution {
  readonly connection: Connection;
  readonly config: AmazonConnectionConfig;
  readonly credentialSource: AmazonCredentialSource;
  readonly client: AmazonSpApiClient;
  /** Present when the connection names a notification queue and its AWS key (#4179). */
  readonly notificationQueue?: AmazonSqsClient;
  /**
   * Same host, authorized with a grantless token for the Notifications API
   * (`sellingpartnerapi::notifications`); minted only when first used (#4179).
   */
  readonly notificationsClient: AmazonSpApiClient;
}

export interface IAmazonAdapterFactory {
  resolve(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    fetchImpl: FetchLike,
    cache?: CachePort,
  ): Promise<AmazonResolution>;
}
