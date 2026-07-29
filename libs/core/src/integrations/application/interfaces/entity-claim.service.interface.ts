/**
 * Entity Claim Service Interface
 *
 * Defines the contract for resolving which OTHER connections claim a given
 * internal entity id while holding a capability that would let them write it.
 * Consumers use it to refuse a connection-blind destructive sweep when an
 * internal id turns out to be claimed by more than one capable connection
 * (#1904).
 *
 * @module libs/core/src/integrations/application/interfaces
 * @see {@link EntityClaimService} for the implementation
 */
import type { EntityClaimQuery } from '../types/entity-claim.types';

export interface IEntityClaimService {
  /**
   * Resolve rival claimants of an internal entity id.
   *
   * A rival is a connection that (a) holds an identifier mapping for
   * `(entityType, internalId)`, (b) is not `excludeConnectionId`, and (c) is an
   * active connection with `capability` enabled.
   *
   * Only ACTIVE connections count: a disabled connection is not writing the
   * entity, so it does not hold back a caller's destructive path. Re-enabling it
   * makes it a rival again on the next lookup.
   *
   * @returns Rival connection ids, empty when the reporting connection is the
   *          only capable claimant (the normal case).
   */
  findRivalClaimants(query: EntityClaimQuery): Promise<string[]>;
}
