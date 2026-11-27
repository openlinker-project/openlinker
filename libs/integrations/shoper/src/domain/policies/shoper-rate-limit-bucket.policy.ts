/**
 * Shoper Rate-Limit Bucket Policy
 *
 * Names the outbound rate-limit bucket a Shoper connection draws from. Shoper's
 * API limit is per SHOP and shared by every token and every integration on it
 * (measured live: two tokens hammering one shop together get about half each),
 * so OpenLinker paces every connection to one shop against ONE bucket rather
 * than one per connection (ADR-038 § Amendment). Two connections to one shop
 * are an ordinary setup - the shop as order source on one, as publish
 * destination on another - and with per-connection buckets they would together
 * exceed the shop's budget.
 *
 * One function, consulted by every `forConnection` call site in the plugin AND
 * (through `AdapterMetadata.resolveRateLimitBucketKey`) by the host's
 * rate-limit status read, so the bucket the operator sees is the bucket the
 * transport paces against.
 *
 * @module libs/integrations/shoper/src/domain/policies
 */
import type { Connection } from '@openlinker/core/identifier-mapping';

import { parseShoperBaseUrl } from './shoper-base-url.policy';

const BUCKET_KEY_PREFIX = 'shoper:host:';

/** The bucket key for an already-parsed (and therefore normalised lowercase) shop host. */
export function buildShoperRateLimitBucketKey(host: string): string {
  return `${BUCKET_KEY_PREFIX}${host}`;
}

/**
 * The shared bucket for a connection, from its `config.baseUrl`. Goes through
 * `parseShoperBaseUrl` so every accepted spelling of one shop (`https://`,
 * upper case, surrounding whitespace) lands in the same bucket. An unusable
 * `baseUrl` answers `undefined` - the connection's own bucket - rather than
 * throwing: such a connection cannot reach the shop anyway, and the call that
 * tries will fail with the base-URL error the operator can act on.
 */
export function resolveShoperRateLimitBucketKey(
  connection: Pick<Connection, 'id' | 'config'>,
): string | undefined {
  const base = parseShoperBaseUrl((connection.config ?? {})['baseUrl']);
  return base.ok ? buildShoperRateLimitBucketKey(base.host) : undefined;
}
