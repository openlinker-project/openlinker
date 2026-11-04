/**
 * Shopify Client Builder
 *
 * Turns a connection into a ready GraphQL client: parses the config, resolves
 * and checks the stored credentials, and wires the token provider over the
 * connection-bound transport. Shared by the adapter factory and the connection
 * tester so the two cannot build a client differently.
 *
 * @module libs/integrations/shopify/src/infrastructure/http
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { CachePort } from '@openlinker/shared';
import type { FetchLike } from '@openlinker/shared/http';

import { ShopifyConfigException } from '../../domain/exceptions/shopify-config.exception';
import { parseShopifyConfig } from '../../domain/policies/shopify-config.policy';
import type { ShopifyResolvedConfig } from '../../domain/types/shopify-config.types';
import type { ShopifyCredentials } from '../../domain/types/shopify-credentials.types';
import { ShopifyAccessTokenProvider, type ShopifyTokenMemo } from './shopify-access-token.provider';
import { ShopifyGraphqlClient } from './shopify-graphql-client';

export type { ShopifyTokenMemo } from './shopify-access-token.provider';

export interface BuiltShopifyClient {
  readonly config: ShopifyResolvedConfig;
  readonly client: ShopifyGraphqlClient;
}

function filled(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function buildShopifyClient(
  connection: Connection,
  credentialsResolver: CredentialsResolverPort,
  fetchImpl: FetchLike,
  cache: CachePort | undefined,
  tokenMemo: ShopifyTokenMemo,
): Promise<BuiltShopifyClient> {
  const parsed = parseShopifyConfig(connection.config);
  if (!parsed.ok) {
    throw new ShopifyConfigException(
      connection.id,
      parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; '),
    );
  }
  if (!connection.credentialsRef) {
    throw new ShopifyConfigException(connection.id, 'no stored credentials');
  }
  const credentials = await credentialsResolver.get<ShopifyCredentials>(connection.credentialsRef);
  if (!filled(credentials.accessToken) && !(filled(credentials.clientId) && filled(credentials.clientSecret))) {
    throw new ShopifyConfigException(
      connection.id,
      'stored credentials have neither an access token nor a client id + secret',
    );
  }

  const tokens = new ShopifyAccessTokenProvider(
    parsed.config.storeDomain,
    connection.id,
    credentials,
    fetchImpl,
    cache,
    tokenMemo,
  );
  return {
    config: parsed.config,
    client: new ShopifyGraphqlClient(parsed.config, tokens, fetchImpl),
  };
}
