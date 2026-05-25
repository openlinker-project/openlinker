/**
 * Fulfillment Routing Service unit tests (#832).
 *
 * Mocks the repository port + IIntegrationsService. Covers resolution
 * (rule-hit / default / null-method) and capability+topology compatibility
 * validation on replace (per ADR-012). Method-granular compatibility is #833
 * and not exercised here.
 */

import type { AdapterMetadata, IIntegrationsService } from '@openlinker/core/integrations';
import type { Connection, ConnectionPort } from '@openlinker/core/identifier-mapping';
import { ConnectionNotFoundException } from '@openlinker/core/identifier-mapping';
import { FulfillmentRoutingService } from './fulfillment-routing.service';
import type { FulfillmentRoutingRepositoryPort } from '../../domain/ports/fulfillment-routing-repository.port';
import { FulfillmentRoutingRule } from '../../domain/entities/fulfillment-routing-rule.entity';
import {
  FULFILLMENT_PROCESSOR_KIND,
  type FulfillmentProcessorKind,
} from '../../domain/types/fulfillment-routing.types';
import { IncompatibleProcessorException } from '../../domain/exceptions/incompatible-processor.exception';
import { DuplicateRoutingRuleException } from '../../domain/exceptions/duplicate-routing-rule.exception';

const SOURCE = 'conn-allegro';
const PS = 'conn-prestashop';
const INPOST = 'conn-inpost';

function makeRule(overrides: Partial<FulfillmentRoutingRule> = {}): FulfillmentRoutingRule {
  return new FulfillmentRoutingRule(
    overrides.id ?? 'rule-1',
    overrides.sourceConnectionId ?? SOURCE,
    overrides.sourceDeliveryMethodId ?? 'method-x',
    overrides.processorKind ?? FULFILLMENT_PROCESSOR_KIND.OmpFulfilled,
    overrides.processorConnectionId ?? PS,
    overrides.createdAt ?? new Date(),
    overrides.updatedAt ?? new Date(),
  );
}

describe('FulfillmentRoutingService', () => {
  let repository: jest.Mocked<FulfillmentRoutingRepositoryPort>;
  let integrations: jest.Mocked<IIntegrationsService>;
  let connectionPort: jest.Mocked<ConnectionPort>;
  let service: FulfillmentRoutingService;

  /** Stub `getAdapter` to return a connection declaring the given capabilities. */
  function declareCapabilities(connectionId: string, capabilities: string[]): void {
    integrations.getAdapter.mockResolvedValue({
      connection: { id: connectionId } as Connection,
      metadata: { supportedCapabilities: capabilities } as AdapterMetadata,
    });
  }

  /** Stub `getAdapter` to return per-connection capabilities (for candidate enumeration). */
  function declareCapabilitiesByConnection(capsByConnection: Record<string, string[]>): void {
    integrations.getAdapter.mockImplementation((connectionId: string) =>
      Promise.resolve({
        connection: { id: connectionId } as Connection,
        metadata: {
          supportedCapabilities: capsByConnection[connectionId] ?? [],
        } as AdapterMetadata,
      }),
    );
  }

  /** Build a minimal active-connection list for `connectionPort.list`. */
  function activeConnections(...ids: string[]): Connection[] {
    return ids.map((id) => ({ id }) as Connection);
  }

  beforeEach(() => {
    repository = {
      findBySourceConnectionId: jest.fn(),
      findRule: jest.fn(),
      replaceForConnection: jest.fn(),
    };
    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn(),
      resolveAdapterMetadata: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    };
    connectionPort = {
      get: jest.fn(),
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      disable: jest.fn(),
    };
    service = new FulfillmentRoutingService(repository, integrations, connectionPort);
  });

  describe('resolve', () => {
    it('should return the configured rule decision when a rule matches', async () => {
      repository.findRule.mockResolvedValue(
        makeRule({ processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier, processorConnectionId: INPOST }),
      );

      const result = await service.resolve({
        sourceConnectionId: SOURCE,
        sourceDeliveryMethodId: 'method-x',
      });

      expect(result).toEqual({
        processorKind: 'ol_managed_carrier',
        processorConnectionId: INPOST,
        source: 'rule',
      });
    });

    it('should fall back to the omp_fulfilled default when no rule matches', async () => {
      repository.findRule.mockResolvedValue(null);

      const result = await service.resolve({
        sourceConnectionId: SOURCE,
        sourceDeliveryMethodId: 'method-x',
      });

      expect(result).toEqual({
        processorKind: 'omp_fulfilled',
        processorConnectionId: null,
        source: 'default',
      });
    });

    it('should return the default without a rule lookup when the order has no delivery method', async () => {
      const result = await service.resolve({
        sourceConnectionId: SOURCE,
        sourceDeliveryMethodId: null,
      });

      expect(result.source).toBe('default');
      expect(result.processorKind).toBe('omp_fulfilled');
      expect(repository.findRule).not.toHaveBeenCalled();
    });
  });

  describe('replaceRules', () => {
    it('should persist an omp_fulfilled rule when the processor declares OrderProcessorManager', async () => {
      declareCapabilities(PS, ['OrderProcessorManager']);
      repository.replaceForConnection.mockResolvedValue([]);

      await service.replaceRules(SOURCE, [
        {
          sourceDeliveryMethodId: 'method-x',
          processorKind: FULFILLMENT_PROCESSOR_KIND.OmpFulfilled,
          processorConnectionId: PS,
        },
      ]);

      expect(repository.replaceForConnection).toHaveBeenCalledWith(SOURCE, expect.any(Array));
    });

    it('should reject an omp_fulfilled rule when the processor does not declare OrderProcessorManager', async () => {
      declareCapabilities(PS, ['OfferManager']);

      await expect(
        service.replaceRules(SOURCE, [
          {
            sourceDeliveryMethodId: 'method-x',
            processorKind: FULFILLMENT_PROCESSOR_KIND.OmpFulfilled,
            processorConnectionId: PS,
          },
        ]),
      ).rejects.toBeInstanceOf(IncompatibleProcessorException);
      expect(repository.replaceForConnection).not.toHaveBeenCalled();
    });

    it('should persist an ol_managed_carrier rule for a ShippingProviderManager connection distinct from the source', async () => {
      declareCapabilities(INPOST, ['ShippingProviderManager']);
      repository.replaceForConnection.mockResolvedValue([]);

      await service.replaceRules(SOURCE, [
        {
          sourceDeliveryMethodId: 'method-inpost',
          processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
          processorConnectionId: INPOST,
        },
      ]);

      expect(repository.replaceForConnection).toHaveBeenCalled();
    });

    it('should reject an ol_managed_carrier rule whose processor is the source connection', async () => {
      declareCapabilities(SOURCE, ['ShippingProviderManager']);

      await expect(
        service.replaceRules(SOURCE, [
          {
            sourceDeliveryMethodId: 'method-inpost',
            processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
            processorConnectionId: SOURCE,
          },
        ]),
      ).rejects.toBeInstanceOf(IncompatibleProcessorException);
    });

    it('should persist a source_brokered rule when the processor is the source and declares ShippingProviderManager', async () => {
      declareCapabilities(SOURCE, ['OrderSource', 'ShippingProviderManager']);
      repository.replaceForConnection.mockResolvedValue([]);

      await service.replaceRules(SOURCE, [
        {
          sourceDeliveryMethodId: 'allegro-one-box',
          processorKind: FULFILLMENT_PROCESSOR_KIND.SourceBrokered,
          processorConnectionId: SOURCE,
        },
      ]);

      expect(repository.replaceForConnection).toHaveBeenCalled();
    });

    it('should reject a source_brokered rule whose processor is not the source connection', async () => {
      declareCapabilities(INPOST, ['ShippingProviderManager']);

      await expect(
        service.replaceRules(SOURCE, [
          {
            sourceDeliveryMethodId: 'allegro-one-box',
            processorKind: FULFILLMENT_PROCESSOR_KIND.SourceBrokered,
            processorConnectionId: INPOST,
          },
        ]),
      ).rejects.toBeInstanceOf(IncompatibleProcessorException);
    });

    it('should reject a batch that maps the same delivery method to more than one processor', async () => {
      await expect(
        service.replaceRules(SOURCE, [
          {
            sourceDeliveryMethodId: 'method-x',
            processorKind: FULFILLMENT_PROCESSOR_KIND.OmpFulfilled,
            processorConnectionId: PS,
          },
          {
            sourceDeliveryMethodId: 'method-x',
            processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
            processorConnectionId: INPOST,
          },
        ]),
      ).rejects.toBeInstanceOf(DuplicateRoutingRuleException);

      // Dedup runs before any I/O — no adapter lookup, no write.
      expect(integrations.getAdapter).not.toHaveBeenCalled();
      expect(repository.replaceForConnection).not.toHaveBeenCalled();
    });

    it('should reject an unknown processor kind (exhaustiveness guard)', async () => {
      declareCapabilities(PS, ['OrderProcessorManager']);

      await expect(
        service.replaceRules(SOURCE, [
          {
            sourceDeliveryMethodId: 'method-x',
            processorKind: 'teleporter' as FulfillmentProcessorKind,
            processorConnectionId: PS,
          },
        ]),
      ).rejects.toBeInstanceOf(IncompatibleProcessorException);
      expect(repository.replaceForConnection).not.toHaveBeenCalled();
    });

    it('should reject when the source connection cannot be resolved', async () => {
      integrations.getAdapter.mockRejectedValue(new Error('connection not found'));

      await expect(
        service.replaceRules(SOURCE, [
          {
            sourceDeliveryMethodId: 'method-x',
            processorKind: FULFILLMENT_PROCESSOR_KIND.OmpFulfilled,
            processorConnectionId: PS,
          },
        ]),
      ).rejects.toThrow('connection not found');
      expect(repository.replaceForConnection).not.toHaveBeenCalled();
    });
  });

  describe('getRules', () => {
    it('should delegate to the repository when the connection exists', async () => {
      const rules = [makeRule()];
      connectionPort.get.mockResolvedValue({ id: SOURCE } as Connection);
      repository.findBySourceConnectionId.mockResolvedValue(rules);

      await expect(service.getRules(SOURCE)).resolves.toBe(rules);
      expect(repository.findBySourceConnectionId).toHaveBeenCalledWith(SOURCE);
    });

    it('should reject and not query rules when the connection does not exist', async () => {
      connectionPort.get.mockRejectedValue(new ConnectionNotFoundException(SOURCE));

      await expect(service.getRules(SOURCE)).rejects.toBeInstanceOf(ConnectionNotFoundException);
      expect(repository.findBySourceConnectionId).not.toHaveBeenCalled();
    });
  });

  describe('getCandidateProcessors', () => {
    it('offers each connection only under the kinds its capabilities + topology allow', async () => {
      declareCapabilitiesByConnection({
        [SOURCE]: ['OrderSource'],
        [PS]: ['OrderProcessorManager'],
        [INPOST]: ['ShippingProviderManager'],
      });
      connectionPort.list.mockResolvedValue(activeConnections(SOURCE, PS, INPOST));

      const candidates = await service.getCandidateProcessors(SOURCE);

      expect(candidates).toEqual(
        expect.arrayContaining([
          { processorKind: 'omp_fulfilled', processorConnectionId: PS },
          { processorKind: 'ol_managed_carrier', processorConnectionId: INPOST },
        ]),
      );
      // SOURCE declares only OrderSource → no source_brokered (needs SPM), not an OMP/carrier.
      expect(candidates).not.toContainEqual({
        processorKind: 'source_brokered',
        processorConnectionId: SOURCE,
      });
      // A distinct carrier connection is never an OMP candidate.
      expect(candidates).not.toContainEqual({
        processorKind: 'omp_fulfilled',
        processorConnectionId: INPOST,
      });
      expect(connectionPort.list).toHaveBeenCalledWith({ status: 'active' });
    });

    it('offers source_brokered for the source connection when it declares ShippingProviderManager', async () => {
      declareCapabilitiesByConnection({ [SOURCE]: ['OrderSource', 'ShippingProviderManager'] });
      connectionPort.list.mockResolvedValue(activeConnections(SOURCE));

      const candidates = await service.getCandidateProcessors(SOURCE);

      expect(candidates).toContainEqual({
        processorKind: 'source_brokered',
        processorConnectionId: SOURCE,
      });
      // Topology: an OL-managed carrier must be distinct from the source.
      expect(candidates).not.toContainEqual({
        processorKind: 'ol_managed_carrier',
        processorConnectionId: SOURCE,
      });
    });

    it('never offers a candidate that replaceRules would reject (shared-predicate consistency)', async () => {
      declareCapabilitiesByConnection({
        [SOURCE]: ['OrderSource', 'ShippingProviderManager'],
        [PS]: ['OrderProcessorManager'],
        [INPOST]: ['ShippingProviderManager'],
      });
      connectionPort.list.mockResolvedValue(activeConnections(SOURCE, PS, INPOST));
      repository.replaceForConnection.mockResolvedValue([]);

      const candidates = await service.getCandidateProcessors(SOURCE);
      expect(candidates.length).toBeGreaterThan(0);

      for (const candidate of candidates) {
        await expect(
          service.replaceRules(SOURCE, [
            {
              sourceDeliveryMethodId: `m-${candidate.processorKind}-${candidate.processorConnectionId}`,
              processorKind: candidate.processorKind,
              processorConnectionId: candidate.processorConnectionId,
            },
          ]),
        ).resolves.toBeDefined();
      }
    });

    it('propagates when the source connection cannot be resolved', async () => {
      integrations.getAdapter.mockRejectedValue(new Error('connection not found'));

      await expect(service.getCandidateProcessors(SOURCE)).rejects.toThrow('connection not found');
      expect(connectionPort.list).not.toHaveBeenCalled();
    });

    it('skips an active connection whose adapter metadata cannot be resolved', async () => {
      const BROKEN = 'conn-broken';
      // SOURCE + PS resolve normally; BROKEN (stale adapterKey, plugin removed)
      // rejects during enumeration. It must be skipped, not fail the whole list.
      integrations.getAdapter.mockImplementation((connectionId: string) => {
        if (connectionId === BROKEN) {
          return Promise.reject(new Error('adapter not registered'));
        }
        const caps: Record<string, string[]> = {
          [SOURCE]: ['OrderSource'],
          [PS]: ['OrderProcessorManager'],
        };
        return Promise.resolve({
          connection: { id: connectionId } as Connection,
          metadata: { supportedCapabilities: caps[connectionId] ?? [] } as AdapterMetadata,
        });
      });
      connectionPort.list.mockResolvedValue(activeConnections(SOURCE, PS, BROKEN));

      const candidates = await service.getCandidateProcessors(SOURCE);

      expect(candidates).toContainEqual({ processorKind: 'omp_fulfilled', processorConnectionId: PS });
      expect(candidates.some((c) => c.processorConnectionId === BROKEN)).toBe(false);
    });
  });
});
