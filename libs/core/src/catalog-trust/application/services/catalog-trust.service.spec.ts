/**
 * Catalog Trust Service Tests (#2258)
 *
 * The invariants worth pinning are the honesty ones: the rung is never
 * asserted for an adapter that did not answer, the completedAt read never
 * throws on a malformed cursor, and a cleared sweep cursor ('') never reads
 * as an open cycle.
 *
 * @module libs/core/src/catalog-trust/application/services
 */
import { CatalogTrustService } from './catalog-trust.service';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { ISyncCursorsService, ISyncJobsService, SchedulerTaskConfig } from '@openlinker/core/sync';

const COMPLETED_AT_KEY = 'master.product-reconcile.completedAt:connection:conn-1';
const SWEEP_CURSOR_KEY = 'master.product-reconcile.sweep:connection:conn-1';

describe('CatalogTrustService', () => {
  let integrationsService: jest.Mocked<
    Pick<IIntegrationsService, 'listCapabilityAdapters' | 'getCapabilityAdapter'>
  >;
  let cursors: jest.Mocked<Pick<ISyncCursorsService, 'getCursor'>>;
  let syncJobs: jest.Mocked<Pick<ISyncJobsService, 'findEnabledTaskByJobType'>>;
  let service: CatalogTrustService;

  const productMasterEntry = (connectionId: string): unknown => ({
    connectionId,
    connection: { id: connectionId },
    // Lazy mode returns the memoized construction PROMISE as `adapter` —
    // the service must never guard-narrow this value directly.
    adapter: Promise.resolve({}),
    metadata: {},
  });

  const baseAdapter = {
    getProduct: jest.fn(),
    listExternalIds: jest.fn(),
  };

  beforeEach(() => {
    integrationsService = {
      listCapabilityAdapters: jest.fn().mockResolvedValue([productMasterEntry('conn-1')]),
      getCapabilityAdapter: jest.fn().mockResolvedValue(baseAdapter),
    } as unknown as jest.Mocked<
      Pick<IIntegrationsService, 'listCapabilityAdapters' | 'getCapabilityAdapter'>
    >;
    cursors = { getCursor: jest.fn().mockResolvedValue(null) };
    syncJobs = { findEnabledTaskByJobType: jest.fn().mockReturnValue(null) };

    service = new CatalogTrustService(
      integrationsService as unknown as IIntegrationsService,
      cursors as unknown as ISyncCursorsService,
      syncJobs as unknown as ISyncJobsService
    );
  });

  describe('applicability', () => {
    it('should return null when the connection has no ProductMaster capability', async () => {
      integrationsService.listCapabilityAdapters.mockResolvedValue([]);

      const result = await service.getConnectionCatalogTrust('conn-1');

      expect(result).toBeNull();
      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('should enumerate connections of every status, not only active ones', async () => {
      await service.getConnectionCatalogTrust('conn-1');

      expect(integrationsService.listCapabilityAdapters).toHaveBeenCalledWith({
        capability: 'ProductMaster',
        lazy: true,
        includeAllStatuses: true,
      });
    });
  });

  describe('the rung', () => {
    it('should report modified-since when the dispatched adapter declares the lister', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        ...baseAdapter,
        listExternalIdsModifiedSince: jest.fn(),
      });

      const result = await service.getConnectionCatalogTrust('conn-1');

      expect(result?.rung).toBe('modified-since');
      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        'conn-1',
        'ProductMaster'
      );
    });

    it('should report full-enumeration for a base-rung adapter — a declared state, not a degradation', async () => {
      const result = await service.getConnectionCatalogTrust('conn-1');

      expect(result?.rung).toBe('full-enumeration');
    });

    it('should degrade to unknown when the adapter cannot be resolved, never asserting a rung', async () => {
      integrationsService.getCapabilityAdapter.mockRejectedValue(new Error('needs_reauth'));

      const result = await service.getConnectionCatalogTrust('conn-1');

      expect(result?.rung).toBe('unknown');
    });
  });

  describe('deltaPassEnabled', () => {
    it('should report true only when the delta scheduler task is currently enabled', async () => {
      syncJobs.findEnabledTaskByJobType.mockReturnValue({
        taskId: 'master-product-delta-sync',
      } as SchedulerTaskConfig);

      const result = await service.getConnectionCatalogTrust('conn-1');

      expect(result?.deltaPassEnabled).toBe(true);
      expect(syncJobs.findEnabledTaskByJobType).toHaveBeenCalledWith('master.product.syncDelta');
    });

    it('should report false when the task is unregistered or disabled', async () => {
      const result = await service.getConnectionCatalogTrust('conn-1');

      expect(result?.deltaPassEnabled).toBe(false);
    });
  });

  describe('reconcile recency', () => {
    it('should parse a stored ISO completedAt cursor', async () => {
      cursors.getCursor.mockImplementation((_conn, key) =>
        Promise.resolve(key === COMPLETED_AT_KEY ? '2026-08-20T12:00:00.000Z' : null)
      );

      const result = await service.getConnectionCatalogTrust('conn-1');

      expect(result?.lastReconcileCompletedAt).toEqual(new Date('2026-08-20T12:00:00.000Z'));
    });

    it('should report null when no cycle has ever completed (missing or empty cursor)', async () => {
      cursors.getCursor.mockResolvedValue('');

      const result = await service.getConnectionCatalogTrust('conn-1');

      expect(result?.lastReconcileCompletedAt).toBeNull();
    });

    it('should treat a malformed completedAt value as absent rather than throwing', async () => {
      cursors.getCursor.mockImplementation((_conn, key) =>
        Promise.resolve(key === COMPLETED_AT_KEY ? 'not-a-date' : null)
      );

      const result = await service.getConnectionCatalogTrust('conn-1');

      expect(result?.lastReconcileCompletedAt).toBeNull();
    });
  });

  describe('reconcileCycleOpen', () => {
    it('should report an open cycle when the sweep cursor holds a value', async () => {
      cursors.getCursor.mockImplementation((_conn, key) =>
        Promise.resolve(key === SWEEP_CURSOR_KEY ? 'cycle-abc:100' : null)
      );

      const result = await service.getConnectionCatalogTrust('conn-1');

      expect(result?.reconcileCycleOpen).toBe(true);
    });

    it("should NOT report an open cycle for the completing branch's '' clear", async () => {
      cursors.getCursor.mockImplementation((_conn, key) =>
        Promise.resolve(key === SWEEP_CURSOR_KEY ? '' : null)
      );

      const result = await service.getConnectionCatalogTrust('conn-1');

      expect(result?.reconcileCycleOpen).toBe(false);
    });

    it('should NOT report an open cycle when the cursor was never written', async () => {
      const result = await service.getConnectionCatalogTrust('conn-1');

      expect(result?.reconcileCycleOpen).toBe(false);
    });
  });
});
