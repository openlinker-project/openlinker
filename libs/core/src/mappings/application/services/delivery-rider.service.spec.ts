/**
 * Delivery Rider Service Unit Tests (#1792)
 *
 * Covers all three rider branches (unmapped / not-connected / none), the
 * heuristic table wiring, and the critical invariant that the rider is a pure
 * read that never touches fulfillment routing.
 *
 * @module libs/core/src/mappings/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import {
  ADAPTER_REGISTRY_TOKEN,
  INTEGRATIONS_SERVICE_TOKEN,
  type AdapterRegistryPort,
  type AdapterMetadata,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import { DeliveryRiderService } from './delivery-rider.service';
import type { DeliveryRiderInput } from '../../domain/types/delivery-rider.types';

/** A connected active carrier connection of a given platformType. */
const connectedCarrier = (platformType: string): { connection: { platformType: string } } => ({
  connection: { platformType },
});

/** A registered adapter manifest declaring ShippingProviderManager. */
const carrierAdapter = (platformType: string): AdapterMetadata =>
  ({
    adapterKey: `${platformType}.test.v1`,
    platformType,
    supportedCapabilities: ['ShippingProviderManager'],
    displayName: `${platformType} test`,
    version: '1.0.0',
  }) as AdapterMetadata;

const defaultInput = (
  overrides: Partial<DeliveryRiderInput> = {}
): DeliveryRiderInput => ({
  sourceConnectionId: 'conn-source-1',
  sourceDeliveryMethod: { name: 'Allegro Paczkomat InPost', typeId: 'ai-1' },
  resolutionSource: 'default',
  routedProcessorDisabled: false,
  ...overrides,
});

describe('DeliveryRiderService', () => {
  let service: DeliveryRiderService;
  let integrations: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>>;
  let registry: jest.Mocked<Pick<AdapterRegistryPort, 'listAdapters'>>;

  beforeEach(async () => {
    integrations = { listCapabilityAdapters: jest.fn().mockResolvedValue([]) };
    registry = { listAdapters: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryRiderService,
        { provide: INTEGRATIONS_SERVICE_TOKEN, useValue: integrations },
        { provide: ADAPTER_REGISTRY_TOKEN, useValue: registry },
      ],
    }).compile();

    service = module.get(DeliveryRiderService);
  });

  describe('resolve', () => {
    it('returns "unmapped" when the method maps to a CONNECTED carrier', async () => {
      integrations.listCapabilityAdapters.mockResolvedValue([connectedCarrier('inpost')] as never);
      registry.listAdapters.mockResolvedValue([carrierAdapter('inpost')]);

      const result = await service.resolve(defaultInput());

      expect(result).toEqual({
        rider: 'unmapped',
        candidateCarrier: { platformType: 'inpost', displayName: 'InPost' },
      });
      // Read carrier state through the integrations seam, filtering on the
      // ShippingProviderManager capability (never a concrete adapter).
      expect(integrations.listCapabilityAdapters).toHaveBeenCalledWith(
        expect.objectContaining({ capability: 'ShippingProviderManager', lazy: true })
      );
    });

    it('returns "not-connected" when the carrier is SUPPORTED (registered) but not connected', async () => {
      integrations.listCapabilityAdapters.mockResolvedValue([] as never);
      registry.listAdapters.mockResolvedValue([carrierAdapter('inpost'), carrierAdapter('dpd')]);

      const result = await service.resolve(defaultInput({ sourceDeliveryMethod: { name: 'Kurier DPD', typeId: null } }));

      expect(result).toEqual({
        rider: 'not-connected',
        candidateCarrier: { platformType: 'dpd', displayName: 'DPD' },
      });
    });

    it('returns "none" when the matched carrier is neither connected nor supported', async () => {
      integrations.listCapabilityAdapters.mockResolvedValue([] as never);
      registry.listAdapters.mockResolvedValue([]); // dpd plugin not loaded

      const result = await service.resolve(defaultInput({ sourceDeliveryMethod: { name: 'Kurier DPD', typeId: null } }));

      expect(result).toEqual({ rider: 'none' });
    });

    it('returns "none" for a method that maps to no carrier', async () => {
      const result = await service.resolve(
        defaultInput({ sourceDeliveryMethod: { name: 'Kurier standardowy', typeId: 'courier-1' } })
      );

      expect(result).toEqual({ rider: 'none' });
      // No carrier candidate → no carrier-state reads at all.
      expect(integrations.listCapabilityAdapters).not.toHaveBeenCalled();
      expect(registry.listAdapters).not.toHaveBeenCalled();
    });

    it('returns "none" for a NON-default resolution, without reading carrier state', async () => {
      const result = await service.resolve(defaultInput({ resolutionSource: 'rule' }));

      expect(result).toEqual({ rider: 'none' });
      expect(integrations.listCapabilityAdapters).not.toHaveBeenCalled();
      expect(registry.listAdapters).not.toHaveBeenCalled();
    });

    it('prefers "unmapped" over "not-connected" when the carrier is both connected and supported', async () => {
      integrations.listCapabilityAdapters.mockResolvedValue([connectedCarrier('inpost')] as never);
      registry.listAdapters.mockResolvedValue([carrierAdapter('inpost')]);

      const result = await service.resolve(defaultInput());

      expect(result.rider).toBe('unmapped');
    });

    it('returns "disabled" for a rule routed to a disabled carrier, without reading carrier state (#1799)', async () => {
      const result = await service.resolve(
        defaultInput({ resolutionSource: 'rule', routedProcessorDisabled: true })
      );

      expect(result).toEqual({
        rider: 'disabled',
        candidateCarrier: { platformType: 'inpost', displayName: 'InPost' },
      });
      // The rule already named the carrier — no active-carrier enumeration needed.
      expect(integrations.listCapabilityAdapters).not.toHaveBeenCalled();
      expect(registry.listAdapters).not.toHaveBeenCalled();
    });

    it('still surfaces "disabled" (no candidateCarrier) when the method maps to no known carrier (#1799)', async () => {
      const result = await service.resolve(
        defaultInput({
          resolutionSource: 'rule',
          routedProcessorDisabled: true,
          sourceDeliveryMethod: { name: 'Kurier standardowy', typeId: 'courier-1' },
        })
      );

      // A disabled route must never be invisible - the rider stays `disabled`
      // even when the heuristic can't name the carrier.
      expect(result).toEqual({ rider: 'disabled' });
    });
  });

  describe('resolveBatch', () => {
    it('resolves each input positionally and reads carrier state ONCE for the whole batch', async () => {
      integrations.listCapabilityAdapters.mockResolvedValue([connectedCarrier('inpost')] as never);
      registry.listAdapters.mockResolvedValue([carrierAdapter('inpost'), carrierAdapter('dpd')]);

      const results = await service.resolveBatch([
        defaultInput(), // inpost, connected → unmapped
        defaultInput({ sourceDeliveryMethod: { name: 'Kurier DPD', typeId: null } }), // dpd, supported → not-connected
        defaultInput({ sourceDeliveryMethod: { name: 'Kurier standardowy', typeId: null } }), // none
        defaultInput({ resolutionSource: 'rule' }), // rule → none
      ]);

      expect(results.map((r) => r.rider)).toEqual([
        'unmapped',
        'not-connected',
        'none',
        'none',
      ]);
      // Carrier-state reads happen once, not per order.
      expect(integrations.listCapabilityAdapters).toHaveBeenCalledTimes(1);
      expect(registry.listAdapters).toHaveBeenCalledTimes(1);
    });

    it('skips carrier-state reads entirely when no input has an actionable candidate', async () => {
      const results = await service.resolveBatch([
        defaultInput({ resolutionSource: 'rule' }),
        defaultInput({ sourceDeliveryMethod: { name: 'Kurier standardowy', typeId: null } }),
      ]);

      expect(results).toEqual([{ rider: 'none' }, { rider: 'none' }]);
      expect(integrations.listCapabilityAdapters).not.toHaveBeenCalled();
      expect(registry.listAdapters).not.toHaveBeenCalled();
    });

    it('resolves a disabled-carrier rule to "disabled" without carrier-state reads, even mixed in a batch (#1799)', async () => {
      integrations.listCapabilityAdapters.mockResolvedValue([connectedCarrier('inpost')] as never);
      registry.listAdapters.mockResolvedValue([carrierAdapter('inpost')]);

      const results = await service.resolveBatch([
        defaultInput({ resolutionSource: 'rule', routedProcessorDisabled: true }), // disabled
        defaultInput(), // default, connected → unmapped
      ]);

      expect(results.map((r) => r.rider)).toEqual(['disabled', 'unmapped']);
      expect(results[0].candidateCarrier).toEqual({ platformType: 'inpost', displayName: 'InPost' });
      // Carrier-state still read only once, for the default-path input.
      expect(integrations.listCapabilityAdapters).toHaveBeenCalledTimes(1);
    });

    it('resolves a disabled-carrier rule with no default-path inputs and skips carrier-state reads (#1799)', async () => {
      const results = await service.resolveBatch([
        defaultInput({ resolutionSource: 'rule', routedProcessorDisabled: true }),
      ]);

      expect(results.map((r) => r.rider)).toEqual(['disabled']);
      expect(integrations.listCapabilityAdapters).not.toHaveBeenCalled();
      expect(registry.listAdapters).not.toHaveBeenCalled();
    });
  });

  describe('routing isolation (critical invariant)', () => {
    it('depends only on the integrations + registry read seams — it takes NO routing collaborator', () => {
      // The service constructor accepts exactly the two read ports; there is no
      // FulfillmentRoutingService dependency, so the heuristic cannot feed back
      // into a routing/dispatch decision. A wrong guess only changes which hint
      // is shown, never where a parcel goes.
      expect(DeliveryRiderService.length).toBe(2);
    });
  });
});
