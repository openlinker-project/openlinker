/**
 * Shopify Client Builder
 *
 * Turns a connection into a ready GraphQL client: parses the config, resolves
 * the stored credentials, and wires the token provider over the
 * connection-bound transport. Shared by the adapter factory and the
 * connection tester so the two cannot build a client differently.
 *
 * @module libs/integrations/shopify/src/infrastructure/http
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { SyncLockPort } from '@openlinker/core/sync';
import type { CachePort } from '@openlinker/shared';
import type { FetchLike } from '@openlinker/shared/http';

import { ShopifyConfigException } from '../../domain/exceptions/shopify-config.exception';
import { parseShopifyConfig } from '../../domain/policies/shopify-config.policy';
import type { ShopifyCredentialsWriterPort } from '../../domain/ports/shopify-credentials-writer.port';
import type { ShopifyResolvedConfig } from '../../domain/types/shopify-config.types';
import type { ShopifyCredentials } from '../../domain/types/shopify-credentials.types';
import { ShopifyAccessTokenProvider, type ShopifyTokenMemo } from './shopify-access-token.provider';
import { ShopifyGraphqlClient, type ShopifyThrottleMemo } from './shopify-graphql-client';

/**
 * State and collaborators that outlive one resolution: the token and throttle
 * memos (per process), and the two Nest-provided pieces the OAuth refresh
 * needs. Owned by the plugin instance.
 */
export interface ShopifyClientRuntime {
  readonly tokenMemo: ShopifyTokenMemo;
  readonly throttleMemo: ShopifyThrottleMemo;
  readonly credentialsWriter?: ShopifyCredentialsWriterPort;
  readonly lock?: SyncLockPort;
}

export function createShopifyClientRuntime(
  deps: Pick<ShopifyClientRuntime, 'credentialsWriter' | 'lock'> = {},
): ShopifyClientRuntime {
  return { tokenMemo: new Map(), throttleMemo: new Map(), ...deps };
}

export interface BuiltShopifyClient {
  readonly config: ShopifyResolvedConfig;
  readonly client: ShopifyGraphqlClient;
}

export async function buildShopifyClient(
  connection: Connection,
  credentialsResolver: CredentialsResolverPort,
  fetchImpl: FetchLike,
  cache: CachePort | undefined,
  runtime: ShopifyClientRuntime,
): Promise<BuiltShopifyClient> {
  const parsed = parseShopifyConfig(connection.config);
  if (!parsed.ok) {
    throw new ShopifyConfigException(
      connection.id,
      parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; '),
      parsed.issues[0]?.path,
    );
  }
  const credentialsRef = connection.credentialsRef;
  if (!credentialsRef) {
    throw new ShopifyConfigException(connection.id, 'no stored credentials');
  }
  const credentials = await credentialsResolver.get<ShopifyCredentials>(credentialsRef);

  const tokens = new ShopifyAccessTokenProvider(
    parsed.config.storeDomain,
    connection.id,
    credentials,
    fetchImpl,
    cache,
    runtime.tokenMemo,
    {
      credentialsRef,
      reload: () => credentialsResolver.get<ShopifyCredentials>(credentialsRef),
      writer: runtime.credentialsWriter,
      lock: runtime.lock,
    },
  );
  return {
    config: parsed.config,
    client: new ShopifyGraphqlClient(parsed.config, tokens, fetchImpl, runtime.throttleMemo),
  };
}
