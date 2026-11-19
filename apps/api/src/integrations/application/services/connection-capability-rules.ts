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

/** True when one connection would be both a catalogue master and a publisher (#3985). */
export function hasMasterAndPublisher(capabilities: readonly string[]): boolean {
  return capabilities.includes('ProductMaster') && capabilities.includes('ProductPublisher');
}

export function masterPublisherConflictError(): ReturnType<typeof codedHttpError> {
  return codedHttpError(
    HttpStatus.BAD_REQUEST,
    'CONNECTION_MASTER_PUBLISHER_CONFLICT',
    'ProductMaster and ProductPublisher cannot both be enabled on the same connection: ' +
      'products published to a shop would be read back by its own catalog sync as new ' +
      'master products, creating duplicates. Keep ProductMaster on the connection that ' +
      'owns the catalog and use ProductPublisher on a separate connection (or vice versa).',
    { capabilities: 'ProductMaster, ProductPublisher' }
  );
}
