/**
 * Fulfillment Routing Service unit tests (#832).
 *
 * Mocks the repository port + IIntegrationsService. Covers resolution
 * (rule-hit / default / null-method) and capability+topology compatibility
 * validation on replace (per ADR-012). Method-granular compatibility is #833
 * and not exercised here.
 */

import type { AdapterMetadata, IIntegrationsService } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
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
  let service: FulfillmentRoutingService;

  /** Stub `getAdapter` to return a connection declaring the given capabilities. */
  function declareCapabilities(connectionId: string, capabilities: string[]): void {
    integrations.getAdapter.mockResolvedValue({
      connection: { id: connectionId } as Connection,
      metadata: { supportedCapabilities: capabilities } as AdapterMetadata,
    });
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
    service = new FulfillmentRoutingService(repository, integrations);
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
    it('should delegate to the repository', async () => {
      const rules = [makeRule()];
      repository.findBySourceConnectionId.mockResolvedValue(rules);

      await expect(service.getRules(SOURCE)).resolves.toBe(rules);
      expect(repository.findBySourceConnectionId).toHaveBeenCalledWith(SOURCE);
    });
  });
});
