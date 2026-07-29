/**
 * Entity Claim Service Tests
 *
 * Covers the rival-claimant resolution behind the master-sync prune guard
 * (#1904): the reporting connection is always excluded, duplicate mappings for
 * one connection collapse, a single-claimant id short-circuits before the
 * capability lookup, and a claimant without the capability enabled is not a
 * rival.
 *
 * @module libs/core/src/integrations/application/services
 */
import { EntityClaimService } from './entity-claim.service';
import type { IIntegrationsService } from '../interfaces/integrations.service.interface';
import type { ExternalIdMapping, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { AdapterMetadata } from '../../domain/types/adapter.types';

const entityType = 'Product';
const internalId = 'ol_product_abc';
const reporting = 'connection-reporting';
const rival = 'connection-rival';

function mapping(connectionId: string, externalId = '1'): ExternalIdMapping {
  return { externalId, platformType: 'prestashop', connectionId, entityType };
}

function capabilityEntry(connectionId: string): {
  connectionId: string;
  connection: Connection;
  adapter: unknown;
  metadata: AdapterMetadata;
} {
  return {
    connectionId,
    connection: { id: connectionId } as unknown as Connection,
    adapter: {},
    metadata: {} as unknown as AdapterMetadata,
  };
}

describe('EntityClaimService', () => {
  let identifierMapping: jest.Mocked<IdentifierMappingPort>;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let service: EntityClaimService;

  beforeEach(() => {
    identifierMapping = {
      getExternalIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IdentifierMappingPort>;

    integrationsService = {
      listCapabilityAdapters: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IIntegrationsService>;

    service = new EntityClaimService(identifierMapping, integrationsService);
  });

  const query = {
    entityType,
    internalId,
    capability: 'ProductMaster',
    excludeConnectionId: reporting,
  };

  it('returns no rivals and skips the capability lookup when only the reporting connection claims the id', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([mapping(reporting)]);

    await expect(service.findRivalClaimants(query)).resolves.toEqual([]);

    expect(identifierMapping.getExternalIds).toHaveBeenCalledWith(entityType, internalId);
    // Short-circuit: the hot sync path must not pay for a connection listing.
    expect(integrationsService.listCapabilityAdapters).not.toHaveBeenCalled();
  });

  it('returns no rivals and skips the capability lookup when no connection claims the id', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([]);

    await expect(service.findRivalClaimants(query)).resolves.toEqual([]);

    expect(integrationsService.listCapabilityAdapters).not.toHaveBeenCalled();
  });

  it('reports a second claimant that has the capability enabled', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([mapping(reporting), mapping(rival, '2')]);
    integrationsService.listCapabilityAdapters.mockResolvedValue([
      capabilityEntry(reporting),
      capabilityEntry(rival),
    ]);

    await expect(service.findRivalClaimants(query)).resolves.toEqual([rival]);

    // Lazy: resolving claimants must never construct adapters or credentials.
    expect(integrationsService.listCapabilityAdapters).toHaveBeenCalledWith({
      capability: 'ProductMaster',
      lazy: true,
    });
  });

  it('ignores a second claimant that does not have the capability enabled', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([mapping(reporting), mapping(rival, '2')]);
    integrationsService.listCapabilityAdapters.mockResolvedValue([capabilityEntry(reporting)]);

    await expect(service.findRivalClaimants(query)).resolves.toEqual([]);
  });

  it('collapses duplicate mappings so one rival connection is reported once', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([
      mapping(rival, '2'),
      mapping(rival, '3'),
      mapping(reporting),
    ]);
    integrationsService.listCapabilityAdapters.mockResolvedValue([capabilityEntry(rival)]);

    await expect(service.findRivalClaimants(query)).resolves.toEqual([rival]);
  });
});
