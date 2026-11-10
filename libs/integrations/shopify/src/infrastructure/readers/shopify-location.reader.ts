/**
 * Shopify Location Reader
 *
 * Reads a connection's locations for the location picker on the connection
 * edit page (#3982). The picker is how an operator fixes a wrong
 * `config.locationId`, so the read ignores the stored one: building the
 * client with it would refuse exactly the connection that needs fixing.
 *
 * Only active locations are listed (Shopify's `locations` default) - an
 * inactive location is refused by the shop context anyway.
 *
 * @module libs/integrations/shopify/src/infrastructure/readers
 */
import { BadRequestException } from '@nestjs/common';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { CachePort } from '@openlinker/shared';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';
import type { ConnectionRateLimit } from '@openlinker/shared/rate-limit';

import { fromShopifyGid } from '../../domain/policies/shopify-gid.policy';
import { resolveShopifyRateLimitBucketKey } from '../../domain/policies/shopify-rate-limit-bucket.policy';
import type { ShopifyConnection, ShopifyLocationNode } from '../../domain/types/shopify-api.types';
import type {
  IShopifyLocationReader,
  ShopifyLocationSummary,
} from '../../domain/types/shopify-location.types';
import { SHOPIFY_PLATFORM_TYPE } from '../../shopify.constants';
import { buildShopifyClient, type ShopifyClientRuntime } from '../http/shopify-client.builder';

const LOCATIONS_QUERY = `query OlShopifyLocations {
  location { id }
  locations(first: 250) { nodes { id name isActive } }
}`;

interface LocationsQuery {
  readonly location: { readonly id: string } | null;
  readonly locations: ShopifyConnection<ShopifyLocationNode>;
}

export function toLocationSummaries(data: LocationsQuery): ShopifyLocationSummary[] {
  const primaryId = data.location?.id ?? null;
  return data.locations.nodes
    .map((node) => ({
      id: fromShopifyGid(node.id),
      name: node.name,
      isActive: node.isActive,
      isPrimary: node.id === primaryId,
    }))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name));
}

export class ShopifyLocationReader implements IShopifyLocationReader {
  constructor(
    private readonly connectionPort: ConnectionPort,
    private readonly credentialsResolver: CredentialsResolverPort,
    private readonly http: HttpTransportFactoryPort,
    private readonly runtime: ShopifyClientRuntime,
    private readonly cache?: CachePort,
    private readonly defaultRateLimit?: ConnectionRateLimit,
  ) {}

  async listLocations(connectionId: string): Promise<ShopifyLocationSummary[]> {
    const connection = await this.connectionPort.get(connectionId);
    if (connection.platformType !== SHOPIFY_PLATFORM_TYPE) {
      throw new BadRequestException(`Connection ${connectionId} is not a Shopify connection.`);
    }
    const config = { ...((connection.config ?? {}) as Record<string, unknown>) };
    delete config.locationId;
    const readable = { ...connection, config };

    const { client } = await buildShopifyClient(
      readable,
      this.credentialsResolver,
      this.http.forConnection(connection, this.defaultRateLimit, {
        bucketKey: resolveShopifyRateLimitBucketKey(connection),
      }),
      this.cache,
      this.runtime,
    );
    return toLocationSummaries(await client.query<LocationsQuery>(LOCATIONS_QUERY));
  }
}
