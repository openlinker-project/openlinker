/**
 * Publish-target guard
 *
 * The one place that decides whether a shop publish may target a connection.
 * Stated in capability terms (never by platform): a connection that is both a
 * `ProductMaster` and a `ProductPublisher` reads its own published products
 * back as new master products. Connection create/update refuses that pair
 * (#4123); this covers connections saved before the rule.
 *
 * @module libs/core/src/listings/domain
 */
import type { Connection } from '@openlinker/core/identifier-mapping';

import { ShopPublishMasterPublisherConflictException } from './exceptions/shop-publish-master-publisher-conflict.exception';

export function ensurePublishTargetAllowed(
  connection: Pick<Connection, 'id' | 'enabledCapabilities'>
): void {
  const enabled = connection.enabledCapabilities ?? [];
  if (enabled.includes('ProductMaster') && enabled.includes('ProductPublisher')) {
    throw new ShopPublishMasterPublisherConflictException(connection.id);
  }
}
