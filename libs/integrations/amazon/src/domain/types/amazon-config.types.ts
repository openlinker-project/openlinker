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
  /**
   * The operator's SQS queue Amazon delivers notifications to (#4179). Absent
   * means orders arrive by polling only.
   */
  readonly notificationQueue?: AmazonNotificationQueue;
  /**
   * The seller's merchant token (Seller Central: Settings > Account Info >
   * Your Merchant Token). The Listings Items API addresses every listing by
   * it, and no SP-API call returns it to a self-authorized app (#4180).
   */
  readonly sellerId?: string;
  /**
   * Amazon `product_tax_code` -> the VAT rate code OpenLinker records
   * (`'23'`, `'8'`, `'zw'`, #4182). Amazon carries a tax CODE, not a rate, so a
   * catalogue read reports the rate as not known unless the operator maps it.
   */
  readonly taxCodeRates?: Readonly<Record<string, string>>;
  /**
   * The marketplace the catalogue is read from (#4182): its listing content,
   * its gross price and currency (ADR-077) and its country for the tax rate.
   * One of `marketplaceIds`; absent means the first of them.
   */
  readonly catalogueMarketplaceId?: string;
}

export interface AmazonNotificationQueue {
  readonly url: string;
  /** AWS region of the queue, read from its URL. */
  readonly region: string;
  /** `arn:aws:sqs:{region}:{account}:{name}`, what Amazon's Notifications API needs. */
  readonly arn: string;
}
