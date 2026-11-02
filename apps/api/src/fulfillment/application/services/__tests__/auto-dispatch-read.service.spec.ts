/**
 * AutoDispatchReadService - unit specs (#2729)
 *
 * The refusal read and the settings preview. Both are reads: the preview must
 * buy nothing and write nothing, and must answer from the SAME decision the
 * worker handler makes, so a draft cannot show a parcel the worker would refuse.
 *
 * @module apps/api/src/fulfillment/application/services/__tests__
 */
import type { FulfillmentWorkView, IFulfillmentWorklistService } from '@openlinker/core/fulfillment';
import type { Connection, ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { ISyncJobsService, SyncJob } from '@openlinker/core/sync';

import type { IAutoDispatchPlanContextLoader } from '../auto-dispatch-plan-context.loader';
import { AutoDispatchReadService } from '../auto-dispatch-read.service';

const CONNECTION_ID = '11111111-1111-1111-1111-111111111111';

function job(overrides: Partial<SyncJob>): SyncJob {
  return {
    id: 'job-1',
    jobType: 'fulfillment.work.autoDispatch',
    connectionId: CONNECTION_ID,
    payload: { schemaVersion: 1, workId: 'w1', orderId: 'ol_order_1' },
    status: 'succeeded',
    attempts: 1,
    maxAttempts: 10,
    lastError: null,
    updatedAt: new Date('2026-10-20T10:00:00Z'),
    outcome: null,
    outcomeReason: null,
    ...overrides,
  } as SyncJob;
}

function page(items: SyncJob[]): Promise<{ items: SyncJob[]; total: number }> {
  return Promise.resolve({ items, total: items.length });
}

const work = (id = 'w1'): FulfillmentWorkView =>
  ({
    id,
    orderId: `ol_order_${id}`,
    lines: [{ productVariantId: 'v1', totalQuantity: 1, cancelledQuantity: 0 }],
  }) as unknown as FulfillmentWorkView;

const order = {
  customerEmail: 'a@b.pl',
  shipping: { methodId: 'courier', methodName: 'Courier' },
  shippingAddress: {
    firstName: 'A',
    lastName: 'B',
    phone: '500',
    address1: 'Street 1',
    city: 'City',
    postalCode: '00-001',
    country: 'PL',
  },
};

describe('AutoDispatchReadService (#2729)', () => {
  let connections: jest.Mocked<ConnectionPort>;
  let syncJobs: jest.Mocked<ISyncJobsService>;
  let worklist: jest.Mocked<IFulfillmentWorklistService>;
  let planContext: jest.Mocked<IAutoDispatchPlanContextLoader>;
  let service: AutoDispatchReadService;

  beforeEach(() => {
    connections = {
      get: jest.fn().mockResolvedValue({
        id: CONNECTION_ID,
        name: 'OpenLinker OMS',
        platformType: 'openlinker',
        enabledCapabilities: ['FulfillmentExecutor'],
        config: { autoDispatch: { enabled: true } },
      } as unknown as Connection),
    } as unknown as jest.Mocked<ConnectionPort>;
    syncJobs = {
      findJobs: jest.fn().mockImplementation(() => page([])),
    } as unknown as jest.Mocked<ISyncJobsService>;
    worklist = {
      list: jest.fn().mockResolvedValue({ works: [work()], total: 1, limit: 10, offset: 0 }),
    } as unknown as jest.Mocked<IFulfillmentWorklistService>;
    planContext = {
      load: jest.fn().mockResolvedValue({
        record: { sourceConnectionId: 's', sourceDeliveryMethodId: 'd' },
        order,
        parcelProfile: null,
        variantWeightGrams: new Map([['v1', 700]]),
        requirementsFor: () => null,
      }),
    } as unknown as jest.Mocked<IAutoDispatchPlanContextLoader>;
    service = new AutoDispatchReadService(connections, syncJobs, worklist, planContext);
  });

  describe('listRefusals', () => {
    it('should say which connection holds the work and whether it can hold any', async () => {
      const view = await service.listRefusals(CONNECTION_ID, 50);

      expect(view.holder).toEqual({
        connectionId: CONNECTION_ID,
        name: 'OpenLinker OMS',
        platformType: 'openlinker',
        holdsWork: true,
        autoDispatchEnabled: true,
      });
    });

    it('should report a connection that cannot hold work as such', async () => {
      connections.get.mockResolvedValue({
        id: CONNECTION_ID,
        name: 'Carrier',
        platformType: 'inpost',
        enabledCapabilities: ['ShippingProviderManager'],
        config: {},
      } as unknown as Connection);

      const view = await service.listRefusals(CONNECTION_ID, 50);

      expect(view.holder.holdsWork).toBe(false);
      expect(view.holder.autoDispatchEnabled).toBe(false);
    });

    it('should split terminal refusals (needs input) from jobs still on the retry ladder', async () => {
      syncJobs.findJobs.mockImplementation((filters) => {
        if (filters.outcome === 'business_failure') {
          return page([
            job({
              id: 'terminal',
              outcome: 'business_failure',
              outcomeReason: 'auto_dispatch_no_weight',
            }),
          ]);
        }
        if (filters.status === 'queued') {
          return page([job({ id: 'ladder', status: 'queued', attempts: 2, lastError: 'timeout' })]);
        }
        return page([]);
      });

      const view = await service.listRefusals(CONNECTION_ID, 50);

      expect(view.needsInput.map((r) => [r.jobId, r.code])).toEqual([['terminal', 'no-weight']]);
      expect(view.retrying.map((r) => [r.jobId, r.code, r.attempts])).toEqual([
        ['ladder', 'carrier-refused', 2],
      ]);
    });

    it('should list a dead job under needs-input, because its retries are spent', async () => {
      syncJobs.findJobs.mockImplementation((filters) =>
        filters.status === 'dead' ? page([job({ id: 'dead', status: 'dead' })]) : page([])
      );

      const view = await service.listRefusals(CONNECTION_ID, 50);

      expect(view.needsInput.map((r) => r.jobId)).toEqual(['dead']);
      expect(view.retrying).toEqual([]);
    });

    it('should not list a queued job that has not failed yet, nor a successful one', async () => {
      syncJobs.findJobs.mockImplementation((filters) => {
        if (filters.status === 'queued') {
          return page([
            job({ id: 'waiting', status: 'queued', attempts: 0, lastError: null }),
            job({ id: 'no-error', status: 'queued', attempts: 3, lastError: null }),
          ]);
        }
        if (filters.outcome === 'business_failure') {
          return page([job({ id: 'ok', outcome: 'ok' })]);
        }
        return page([]);
      });

      const view = await service.listRefusals(CONNECTION_ID, 50);

      expect(view.needsInput).toEqual([]);
      expect(view.retrying).toEqual([]);
    });

    it('should read only jobs of this type on this connection', async () => {
      await service.listRefusals(CONNECTION_ID, 50);

      for (const [filters] of syncJobs.findJobs.mock.calls) {
        expect(filters).toMatchObject({
          connectionId: CONNECTION_ID,
          jobType: 'fulfillment.work.autoDispatch',
        });
      }
    });

    it('should return the order and work ids and never the raw error text', async () => {
      syncJobs.findJobs.mockImplementation((filters) =>
        filters.status === 'queued'
          ? page([
              job({
                id: 'ladder',
                status: 'queued',
                attempts: 1,
                lastError: 'carrier rejected: Jan Kowalski, ul. Testowa 1',
              }),
            ])
          : page([])
      );

      const view = await service.listRefusals(CONNECTION_ID, 50);

      expect(view.retrying[0]).toMatchObject({ workId: 'w1', orderId: 'ol_order_1' });
      expect(JSON.stringify(view)).not.toContain('Kowalski');
    });

    it('should cap each bucket at the requested limit, newest first', async () => {
      syncJobs.findJobs.mockImplementation((filters) =>
        filters.outcome === 'business_failure'
          ? page([
              job({ id: 'old', outcome: 'business_failure', outcomeReason: 'auto_dispatch_no_address', updatedAt: new Date('2026-10-01T00:00:00Z') }),
              job({ id: 'new', outcome: 'business_failure', outcomeReason: 'auto_dispatch_no_address', updatedAt: new Date('2026-10-02T00:00:00Z') }),
            ])
          : page([])
      );

      const view = await service.listRefusals(CONNECTION_ID, 1);

      expect(view.needsInput.map((r) => r.jobId)).toEqual(['new']);
    });
  });

  describe('preview', () => {
    it('should resolve weight from the catalogue and flag nothing when the order can be labelled', async () => {
      const view = await service.preview(CONNECTION_ID, {}, 10);

      expect(view.items).toEqual([
        {
          workId: 'w1',
          orderId: 'ol_order_w1',
          weightGrams: 700,
          template: null,
          dimensions: null,
          refusal: null,
        },
      ]);
    });

    it('should preview the connection’s own recent work, newest page, nothing else', async () => {
      await service.preview(CONNECTION_ID, {}, 7);

      expect(worklist.list).toHaveBeenCalledWith({
        assignedConnectionId: [CONNECTION_ID],
        limit: 7,
      });
    });

    it('should apply the DRAFT settings, so a typed fallback weight clears a no-weight refusal', async () => {
      planContext.load.mockResolvedValue({
        record: {},
        order,
        parcelProfile: null,
        variantWeightGrams: new Map(),
        requirementsFor: () => null,
      } as never);

      const without = await service.preview(CONNECTION_ID, {}, 10);
      const withFallback = await service.preview(CONNECTION_ID, { defaultWeightGrams: 250 }, 10);

      expect(without.items[0].refusal).toBe('no-weight');
      expect(withFallback.items[0]).toMatchObject({ refusal: null, weightGrams: 250 });
    });

    it('should show the template and the box a draft would put on the parcel', async () => {
      const view = await service.preview(
        CONNECTION_ID,
        { parcelTemplate: 'small', lengthMm: 300, widthMm: 200, heightMm: 100 },
        10
      );

      expect(view.items[0]).toMatchObject({
        template: 'small',
        dimensions: { length: 300, width: 200, height: 100 },
      });
    });

    it('should drop a draft value the saved config would drop (a partial box reads as no box)', async () => {
      const view = await service.preview(CONNECTION_ID, { lengthMm: 300, widthMm: 200 }, 10);

      expect(view.items[0].dimensions).toBeNull();
    });

    it('should flag no-dimensions for a carrier that needs a box the draft does not supply', async () => {
      planContext.load.mockResolvedValue({
        record: {},
        order,
        parcelProfile: null,
        variantWeightGrams: new Map([['v1', 700]]),
        requirementsFor: () => ({ requiresDimensions: true }),
      } as never);

      const view = await service.preview(CONNECTION_ID, {}, 10);

      expect(view.items[0]).toMatchObject({ refusal: 'no-dimensions', weightGrams: null });
    });

    it('should flag no-address when the order has no deliverable recipient', async () => {
      planContext.load.mockResolvedValue({
        record: {},
        order: { ...order, shippingAddress: undefined },
        parcelProfile: null,
        variantWeightGrams: new Map([['v1', 700]]),
        requirementsFor: () => null,
      } as never);

      const view = await service.preview(CONNECTION_ID, {}, 10);

      expect(view.items[0].refusal).toBe('no-address');
    });

    it('should flag order-unreadable rather than failing the whole preview', async () => {
      worklist.list.mockResolvedValue({
        works: [work('w1'), work('w2')],
        total: 2,
        limit: 10,
        offset: 0,
      } as never);
      planContext.load
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          record: {},
          order,
          parcelProfile: null,
          variantWeightGrams: new Map([['v1', 700]]),
          requirementsFor: () => null,
        } as never);

      const view = await service.preview(CONNECTION_ID, {}, 10);

      expect(view.items.map((i) => i.refusal)).toEqual(['order-unreadable', null]);
    });

    it('should report one unreadable work as its own row, not fail the whole preview', async () => {
      worklist.list.mockResolvedValue({
        works: [work('w1'), work('w2')],
        total: 2,
        limit: 10,
        offset: 0,
      } as never);
      planContext.load.mockRejectedValueOnce(new Error('routing read failed')).mockResolvedValueOnce({
        record: {},
        order,
        parcelProfile: null,
        variantWeightGrams: new Map([['v1', 700]]),
        requirementsFor: () => null,
      } as never);

      const view = await service.preview(CONNECTION_ID, {}, 10);

      expect(view.items.map((i) => i.refusal)).toEqual(['order-unreadable', null]);
    });

    it('should read only: it touches no write seam at all', async () => {
      await service.preview(CONNECTION_ID, { defaultWeightGrams: 250 }, 10);

      // The service is constructed with reads only; nothing in this graph can
      // schedule a job or buy a label. Pinned so a future write is a test change.
      expect(Object.keys(syncJobs)).toEqual(['findJobs']);
      expect(Object.keys(worklist)).toEqual(['list']);
      expect(Object.keys(planContext)).toEqual(['load']);
    });
  });
});
