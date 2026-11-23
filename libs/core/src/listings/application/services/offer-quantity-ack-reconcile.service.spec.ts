/**
 * Offer Quantity Ack Reconcile Service Tests
 *
 * Covers the two branches `OfferQuantityAckReconcileService` owns (#2621,
 * tech-review follow-up): delegating to an adapter that declares
 * `PendingQuantityAckReconciler`, and no-opping with a zeroed result for one
 * that doesn't, and (#4284) asking the `InventoryMaster` adapter on a stock
 * master connection that holds no `OfferManager`.
 *
 * @module libs/core/src/listings/application/services
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type {
  OfferManagerPort,
  PendingQuantityAckReconcileResult,
} from '@openlinker/core/listings';

import { OfferQuantityAckReconcileService } from './offer-quantity-ack-reconcile.service';

const CONNECTION_ID = 'conn-allegro-1';

function withCapabilities(
  enabledCapabilities: string[]
): Awaited<ReturnType<IIntegrationsService['getAdapter']>> {
  return {
    connection: { id: CONNECTION_ID, enabledCapabilities },
    metadata: {},
  } as unknown as Awaited<ReturnType<IIntegrationsService['getAdapter']>>;
}

describe('OfferQuantityAckReconcileService', () => {
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let service: OfferQuantityAckReconcileService;

  beforeEach(() => {
    integrationsService = {
      getAdapter: jest.fn().mockResolvedValue(withCapabilities(['OfferManager', 'OrderSource'])),
      getCapabilityAdapter: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    service = new OfferQuantityAckReconcileService(integrationsService);
  });

  describe('reconcile', () => {
    it('should delegate to the adapter and return its result when the adapter implements PendingQuantityAckReconciler', async () => {
      const expected: PendingQuantityAckReconcileResult = { reconciled: 3, stillPending: 2 };
      const reconcilePendingQuantityAcks = jest.fn().mockResolvedValue(expected);
      const adapter = {
        updateOfferQuantity: jest.fn(),
        reconcilePendingQuantityAcks,
      } as unknown as OfferManagerPort;
      integrationsService.getCapabilityAdapter.mockResolvedValue(adapter);

      const result = await service.reconcile(CONNECTION_ID, 100);

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        CONNECTION_ID,
        'OfferManager'
      );
      expect(reconcilePendingQuantityAcks).toHaveBeenCalledWith(100);
      expect(result).toEqual(expected);
    });

    it('should no-op with a zeroed result when the resolved adapter does not implement PendingQuantityAckReconciler', async () => {
      const adapter = {
        updateOfferQuantity: jest.fn(),
      } as unknown as OfferManagerPort;
      integrationsService.getCapabilityAdapter.mockResolvedValue(adapter);

      const result = await service.reconcile(CONNECTION_ID, 100);

      expect(result).toEqual({ reconciled: 0, stillPending: 0 });
    });

    it('should ask the inventory master on a stock master connection without OfferManager', async () => {
      const expected: PendingQuantityAckReconcileResult = { reconciled: 1, stillPending: 0 };
      const reconcilePendingQuantityAcks = jest.fn().mockResolvedValue(expected);
      integrationsService.getAdapter.mockResolvedValue(
        withCapabilities(['ProductMaster', 'InventoryMaster'])
      );
      integrationsService.getCapabilityAdapter.mockResolvedValue({ reconcilePendingQuantityAcks });

      const result = await service.reconcile(CONNECTION_ID, 50);

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        CONNECTION_ID,
        'InventoryMaster'
      );
      expect(reconcilePendingQuantityAcks).toHaveBeenCalledWith(50);
      expect(result).toEqual(expected);
    });

    it('should no-op on a stock master that keeps no pending writes', async () => {
      integrationsService.getAdapter.mockResolvedValue(withCapabilities(['InventoryMaster']));
      integrationsService.getCapabilityAdapter.mockResolvedValue({ getInventory: jest.fn() });

      await expect(service.reconcile(CONNECTION_ID, 50)).resolves.toEqual({
        reconciled: 0,
        stillPending: 0,
      });
    });

    it('should propagate a capability-resolution failure rather than swallowing it', async () => {
      integrationsService.getCapabilityAdapter.mockRejectedValue(new Error('connection disabled'));

      await expect(service.reconcile(CONNECTION_ID, 100)).rejects.toThrow('connection disabled');
    });
  });
});
