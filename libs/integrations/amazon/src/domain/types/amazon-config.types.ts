/**
 * Amazon Connection Config Types
 *
 * The non-secret half of an Amazon connection, stored in `Connection.config`.
 * One connection is one seller account in one region, selling in one or more
 * of that region's marketplaces; `marketplaceIds` is passed per call.
 *
 * Whether one connection per marketplace is the better grain is an open
 * question (#3741, AC4); this shape keeps the marketplace axis inside the
 * connection, which a single refresh token covering every EU marketplace
 * already implies.
 *
 * @module libs/integrations/amazon/src/domain/types
 */
import type { AmazonEnvironment, AmazonRegion } from '../../amazon.constants';

export interface AmazonConnectionConfig {
  readonly region: AmazonRegion;
  readonly environment: AmazonEnvironment;
  /** At least one; the marketplaces this connection sells in. */
  readonly marketplaceIds: readonly string[];
}
