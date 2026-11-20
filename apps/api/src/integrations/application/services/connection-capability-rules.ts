/**
 * Connection capability rules
 *
 * Capability-set rules that more than one entry point must apply identically:
 * `ConnectionService` on create/update, and a controller that accepts a
 * capability choice before the connection exists (an OAuth install creates it
 * only after the operator approved the app, so a refusal there must come first).
 * Stated in capability terms, never by platform.
 *
 * @module apps/api/src/integrations/application/services
 */
import { HttpStatus } from '@nestjs/common';
import { codedHttpError } from '../../../common/errors/coded-http.exception';

/**
 * The publishing role a capability set holds, or null (#3985, #4182).
 *
 * Two roles publish: `ProductPublisher` (a shop), and an `OfferManager` whose
 * adapter advertises `OfferCreator`, i.e. one that creates new listings on a
 * marketplace that can also be read as a catalogue (Amazon). An `OfferManager`
 * without `OfferCreator` only writes stock and price to listings that already
 * exist (WooCommerce write-back) and is not a publisher.
 */
export function publisherRole(
  capabilities: readonly string[],
  supportedCapabilities: readonly string[] = []
): 'ProductPublisher' | 'OfferManager' | null {
  if (capabilities.includes('ProductPublisher')) return 'ProductPublisher';
  if (capabilities.includes('OfferManager') && supportedCapabilities.includes('OfferCreator')) {
    return 'OfferManager';
  }
  return null;
}

/** True when one connection would be both a catalogue master and a publisher (#3985). */
export function hasMasterAndPublisher(
  capabilities: readonly string[],
  supportedCapabilities: readonly string[] = []
): boolean {
  return capabilities.includes('ProductMaster') && publisherRole(capabilities, supportedCapabilities) !== null;
}

export function masterPublisherConflictError(
  publisher: 'ProductPublisher' | 'OfferManager' = 'ProductPublisher'
): ReturnType<typeof codedHttpError> {
  const where = publisher === 'ProductPublisher' ? 'to a shop' : 'there';
  return codedHttpError(
    HttpStatus.BAD_REQUEST,
    'CONNECTION_MASTER_PUBLISHER_CONFLICT',
    `ProductMaster and ${publisher} cannot both be enabled on the same connection: ` +
      `products published ${where} would be read back by its own catalog sync as new ` +
      'master products, creating duplicates. Keep ProductMaster on the connection that ' +
      `owns the catalog and use ${publisher} on a separate connection (or vice versa).`,
    { capabilities: `ProductMaster, ${publisher}` }
  );
}
