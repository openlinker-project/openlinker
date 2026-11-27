/**
 * Amazon Paced Transport
 *
 * SP-API quotas are per operation, not one request rate per seller, so a single
 * manifest `defaultRateLimit` would either throttle every call to the slowest
 * operation or pace none of them. Instead this transport sends each hot
 * operation group through its own shared bucket on the host transport
 * (`forConnection(connection, quota, { bucketKey })`), and everything else
 * through the connection's own bucket, which is unlimited unless the operator
 * sets `config.rateLimit`.
 *
 * The groups are the calls that fan out with catalogue or stock size:
 *   - Catalog Items (`searchCatalogItems`, `getCatalogItem`): 2 req/s, burst 2;
 *   - Listings Items (`get/put/patch/searchListingsItems`): 5 req/s, burst 5.
 *
 * The rate is the documented restore rate and the burst becomes the in-flight
 * cap. A connection's `config.rateLimit` can only tighten a group, never raise
 * it. Amazon may still answer 429 (another app on the same seller shares the
 * quota); that surfaces to the job and the retry classifier defers it.
 *
 * @module libs/integrations/amazon/src/infrastructure/http
 */
import type { FetchLike, HttpTransportFactoryPort, RateLimitedConnection } from '@openlinker/shared/http';
import type { ConnectionRateLimit } from '@openlinker/shared/rate-limit';

interface AmazonOperationGroup {
  readonly name: string;
  readonly pathPrefix: string;
  readonly quota: ConnectionRateLimit;
}

export const AMAZON_OPERATION_GROUPS: readonly AmazonOperationGroup[] = [
  { name: 'catalog', pathPrefix: '/catalog/', quota: { requestsPerMinute: 120, maxConcurrent: 2 } },
  { name: 'listings', pathPrefix: '/listings/', quota: { requestsPerMinute: 300, maxConcurrent: 5 } },
];

/** One `FetchLike` that routes each request to its operation group's bucket by URL path. */
export function createAmazonPacedFetch(
  http: HttpTransportFactoryPort,
  connection: RateLimitedConnection,
): FetchLike {
  const fallback = http.forConnection(connection);
  const groups = AMAZON_OPERATION_GROUPS.map((group) => ({
    pathPrefix: group.pathPrefix,
    fetch: http.forConnection(connection, group.quota, { bucketKey: `amazon:${connection.id}:${group.name}` }),
  }));

  return ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = readPath(input);
    const group = path === null ? undefined : groups.find((candidate) => path.startsWith(candidate.pathPrefix));
    return (group?.fetch ?? fallback)(input, init);
  }) as FetchLike;
}

function readPath(input: RequestInfo | URL): string | null {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw).pathname;
  } catch {
    return null;
  }
}
