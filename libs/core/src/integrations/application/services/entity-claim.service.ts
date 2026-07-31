/**
 * Entity Claim Service
 *
 * Resolves which OTHER connections claim a given internal entity id while
 * holding a capability that would let them write it. Backs the master-sync
 * prune guard (#1904): a staleness sweep keyed on an internal id alone is only
 * safe while exactly one capable connection claims that id.
 *
 * @module libs/core/src/integrations/application/services
 * @implements {IEntityClaimService}
 */
import { Injectable, Inject } from '@nestjs/common';
import {
  IdentifierMappingPort,
  IDENTIFIER_MAPPING_PORT_TOKEN,
} from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { INTEGRATIONS_SERVICE_TOKEN } from '../../integrations.tokens';
import { IIntegrationsService } from '../interfaces/integrations.service.interface';
import type { IEntityClaimService } from '../interfaces/entity-claim.service.interface';
import type { EntityClaimQuery } from '../types/entity-claim.types';

@Injectable()
export class EntityClaimService implements IEntityClaimService {
  private readonly logger = new Logger(EntityClaimService.name);

  constructor(
    @Inject(IDENTIFIER_MAPPING_PORT_TOKEN)
    private readonly identifierMapping: IdentifierMappingPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService
  ) {}

  async findRivalClaimants(query: EntityClaimQuery): Promise<string[]> {
    const mappings = await this.identifierMapping.getExternalIds(
      query.entityType,
      query.internalId
    );

    const candidates = [...new Set(mappings.map((mapping) => mapping.connectionId))].filter(
      (connectionId) => connectionId !== query.excludeConnectionId
    );

    // Short-circuit the common case before touching the connection list: a
    // single-claimant id (every id produced by normal operation, since
    // getOrCreateInternalId namespaces per connection) needs no capability
    // lookup at all. Keeps the guard to one indexed read on the hot sync path.
    if (candidates.length === 0) {
      return [];
    }

    // `lazy` keeps this to a connection-list read plus in-memory registry
    // lookups - no adapter is constructed, so no credentials are resolved
    // (#1206). Narrows to connections that both support AND have enabled the
    // capability, so a mapping written by some other flow is not mistaken for a
    // rival writer.
    //
    // The listing aborts on ANY connection's configuration error, including one
    // unrelated to this entity. Letting that propagate would turn a third party's
    // bad config into a thrown caller (a retryable failure) on a path whose whole
    // purpose is to be conservative, so a failure is treated as "capabilities
    // unknown" and every other claimant is reported as a rival - the callers then
    // withhold, which is the same safe outcome as a real hit.
    let capableConnectionIds: Set<string>;
    try {
      const capable = await this.integrationsService.listCapabilityAdapters<unknown>({
        capability: query.capability,
        lazy: true,
      });
      capableConnectionIds = new Set(capable.map((entry) => entry.connectionId));
    } catch (error) {
      this.logger.warn(
        `entity_claim_capability_listing_failed entityType=${query.entityType} internalId=${query.internalId} capability=${query.capability} reporting=${query.excludeConnectionId} candidates=${candidates.join(',')} - reporting every other claimant as a rival so the caller withholds: ${(error as Error).message}`
      );
      return candidates;
    }

    const rivals = candidates.filter((connectionId) => capableConnectionIds.has(connectionId));
    if (rivals.length > 0) {
      // Diagnostic only - the caller owns the operator-facing log, since only it
      // knows what was withheld as a result.
      this.logger.debug(
        `entity_claim_rivals_found entityType=${query.entityType} internalId=${query.internalId} capability=${query.capability} reporting=${query.excludeConnectionId} rivals=${rivals.join(',')}`
      );
    }
    return rivals;
  }
}
