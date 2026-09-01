/**
 * Offer Quantity Ack Reconcile Service Tests
 *
 * Covers the two branches `OfferQuantityAckReconcileService` owns (#2621,
 * tech-review follow-up): delegating to an adapter that declares
 * `PendingQuantityAckReconciler`, and no-opping with a zeroed result for one
 * that doesn't.
 *
 * @module libs/core/src/listings/application/services
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { OfferManagerPort, PendingQuantityAckReconcileResult } from '@openlinker/core/listings';

import { OfferQuantityAckReconcileService } from './offer-quantity-ack-reconcile.service';

const CONNECTION_ID = 'conn-allegro-1';

describe('OfferQuantityAckReconcileService', () => {
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let service: OfferQuantityAckReconcileService;

  beforeEach(() => {
    integrationsService = {
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

    it('should propagate a capability-resolution failure rather than swallowing it', async () => {
      integrationsService.getCapabilityAdapter.mockRejectedValue(
        new Error('connection disabled')
      );

      await expect(service.reconcile(CONNECTION_ID, 100)).rejects.toThrow('connection disabled');
    });
  });
});
