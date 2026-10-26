/**
 * Connection In Use Exception
 *
 * Raised when archiving a connection would leave other connections pointing at
 * one that no longer appears in any list (#3657 review). The reference is a
 * JSONB value (`config.masterCatalogConnectionId`) with no foreign key, so
 * nothing in the database refuses the archive - the refusal is the
 * application service's, and this exception is the vocabulary it uses. Same
 * shape as `LocationInUseError` (#2316).
 *
 * Carries the referrers so the operator is told which connections to re-pair,
 * not just that some exist. The interface layer maps it to 409 Conflict with
 * `reason` and `referrers` in the body.
 *
 * @module libs/core/src/identifier-mapping/domain/exceptions
 */
import type { ConnectionInUseReason, ConnectionReferrer } from '../types/connection.types';

export class ConnectionInUseException extends Error {
  constructor(
    public readonly connectionId: string,
    public readonly reason: ConnectionInUseReason,
    public readonly referrers: readonly ConnectionReferrer[]
  ) {
    super(
      `Connection ${connectionId} is the catalog connection of ${referrers
        .map((referrer) => `"${referrer.name}"`)
        .join(', ')}; change their catalog pairing before archiving it`
    );
    this.name = 'ConnectionInUseException';
    Error.captureStackTrace(this, this.constructor);
  }
}
