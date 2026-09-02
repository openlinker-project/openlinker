/**
 * Analytics Remediation Controller — Unit Tests (#2468)
 *
 * @module apps/api/src/analytics/http
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  OpenRemediationRunExistsError,
  type AnalyticsRemediationRunView,
  type IAnalyticsRemediationRunService,
} from '@openlinker/core/analytics';
import type { IReportingCurrencySettingsService } from '@openlinker/core/currency';
import type { IOrderRecordService } from '@openlinker/core/orders';
import type { JobEnqueuePort } from '@openlinker/core/sync';
import { AnalyticsRemediationController } from './analytics-remediation.controller';

const USER = { id: 'user-1', username: 'admin', role: 'admin' as const };

const RUN: AnalyticsRemediationRunView = {
  id: 'ol_remrun_abc',
  category: 'currency',
  status: 'in-progress',
  detail: null,
  affectedCount: 13,
  triggeredByUserId: 'user-1',
  createdAt: new Date('2026-08-26T09:00:00Z'),
  updatedAt: new Date('2026-08-26T09:00:00Z'),
};

describe('AnalyticsRemediationController (#2468)', () => {
  let runs: jest.Mocked<IAnalyticsRemediationRunService>;
  let orderRecordService: jest.Mocked<Pick<IOrderRecordService, 'getCurrencyMismatchOrders'>>;
  let reportingCurrency: jest.Mocked<Pick<IReportingCurrencySettingsService, 'resolve'>>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let controller: AnalyticsRemediationController;

  beforeEach(() => {
    runs = {
      openRun: jest.fn().mockResolvedValue(RUN),
      getRun: jest.fn(),
      getOpenRun: jest.fn(),
      markResolved: jest.fn(),
      markFailed: jest.fn(),
      cancelOpenRun: jest.fn(),
    };
    orderRecordService = {
      getCurrencyMismatchOrders: jest.fn().mockResolvedValue({ items: [], total: 13 }),
    };
    reportingCurrency = { resolve: jest.fn().mockResolvedValue('EUR') };
    jobEnqueue = { enqueueJob: jest.fn().mockResolvedValue({ jobId: 'job-1', isExisting: false }) };

    controller = new AnalyticsRemediationController(
      runs,
      orderRecordService as unknown as IOrderRecordService,
      reportingCurrency as unknown as IReportingCurrencySettingsService,
      jobEnqueue
    );
  });

  const body = { from: '2026-08-01T00:00:00.000Z', to: '2026-08-27T00:00:00.000Z' };

  describe('recalculate', () => {
    it('should open an in-progress run and enqueue exactly one driver job', async () => {
      const response = await controller.recalculate(body, USER);

      expect(runs.openRun).toHaveBeenCalledWith({
        category: 'currency',
        affectedCount: 13,
        triggeredByUserId: 'user-1',
      });
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
      expect(response).toMatchObject({ id: 'ol_remrun_abc', status: 'in-progress' });
    });

    it('should never perform a data write from the request thread — only the ledger row and the enqueue', async () => {
      // The repair clears an ADR-040 stamp per order and enqueues a stamp job
      // for each; that is the worker's job. The controller is not even given a
      // restatement service to call, which this assertion pins.
      await controller.recalculate(body, USER);

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({ jobType: 'analytics.currency.recalculate' })
      );
      expect(
        Object.keys(controller as unknown as Record<string, unknown>).some((key) =>
          key.toLowerCase().includes('restatement')
        )
      ).toBe(false);
    });

    it('should carry the operator’s own window and cursor start into the driver payload', async () => {
      await controller.recalculate({ ...body, sourceConnectionId: 'conn-1' }, USER);

      const [request] = jobEnqueue.enqueueJob.mock.calls[0];
      expect(request.payload).toEqual({
        schemaVersion: 1,
        runId: 'ol_remrun_abc',
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-27T00:00:00.000Z',
        sourceConnectionId: 'conn-1',
        afterOrderId: null,
        pollCount: 0,
        step: 0,
      });
      expect(request.connectionId).toBe('conn-1');
      expect(request.idempotencyKey).toBe('analytics:remediation:ol_remrun_abc:step:0');
    });

    it('should refuse when nothing is mismatched rather than writing a run that repaired nothing', async () => {
      orderRecordService.getCurrencyMismatchOrders.mockResolvedValue({ items: [], total: 0 });

      await expect(controller.recalculate(body, USER)).rejects.toBeInstanceOf(BadRequestException);
      expect(runs.openRun).not.toHaveBeenCalled();
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should answer 409 when a run is already in flight for the category', async () => {
      runs.openRun.mockRejectedValue(new OpenRemediationRunExistsError('currency'));

      await expect(controller.recalculate(body, USER)).rejects.toBeInstanceOf(ConflictException);
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should reject an inverted range', async () => {
      await expect(
        controller.recalculate({ from: body.to, to: body.from }, USER)
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should reject a range wider than the coverage read allows', async () => {
      await expect(
        controller.recalculate(
          { from: '2024-01-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' },
          USER
        )
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should resolve the reporting currency once and count the population against it', async () => {
      await controller.recalculate(body, USER);

      expect(reportingCurrency.resolve).toHaveBeenCalledTimes(1);
      expect(orderRecordService.getCurrencyMismatchOrders).toHaveBeenCalledWith(
        expect.objectContaining({ sourceConnectionId: undefined }),
        'EUR',
        { limit: 1, offset: 0 }
      );
    });
  });

  describe('cancel (#2816)', () => {
    it('should cancel the open run and return it as failed, so the panel can retry afterwards', async () => {
      runs.getOpenRun.mockResolvedValue(RUN);
      runs.cancelOpenRun.mockResolvedValue(true);
      runs.getRun.mockResolvedValue({
        ...RUN,
        status: 'failed',
        detail: 'Cancelled by operator - previous attempt did not resolve',
      });

      const response = await controller.cancel();

      expect(runs.getOpenRun).toHaveBeenCalledWith('currency');
      expect(runs.cancelOpenRun).toHaveBeenCalledWith(
        'currency',
        'Cancelled by operator - previous attempt did not resolve'
      );
      expect(response).toMatchObject({
        id: 'ol_remrun_abc',
        status: 'failed',
        detail: 'Cancelled by operator - previous attempt did not resolve',
      });
    });

    it('should 404 when there is nothing in flight to cancel', async () => {
      runs.getOpenRun.mockResolvedValue(null);

      await expect(controller.cancel()).rejects.toBeInstanceOf(NotFoundException);
      expect(runs.cancelOpenRun).not.toHaveBeenCalled();
    });

    it('should 404 when the run resolved on its own between the read and the cancel (no false claim of a cancellation)', async () => {
      runs.getOpenRun.mockResolvedValue(RUN);
      runs.cancelOpenRun.mockResolvedValue(false);

      await expect(controller.cancel()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should prove the actual bug scenario: a stuck in-progress run blocks recalculate with 409, and cancel unblocks it', async () => {
      // Simulate the driver job dying: a run sits at 'in-progress' forever.
      runs.getOpenRun.mockResolvedValue(RUN);

      // Before cancelling, a fresh recalculate attempt is refused.
      runs.openRun.mockRejectedValueOnce(new OpenRemediationRunExistsError('currency'));
      await expect(controller.recalculate(body, USER)).rejects.toBeInstanceOf(ConflictException);

      // The operator cancels the stuck run.
      runs.cancelOpenRun.mockResolvedValue(true);
      runs.getRun.mockResolvedValue({ ...RUN, status: 'failed', detail: 'Cancelled by operator' });
      await controller.cancel();

      // A subsequent recalculate now succeeds instead of throwing 409.
      runs.openRun.mockResolvedValueOnce(RUN);
      await expect(controller.recalculate(body, USER)).resolves.toMatchObject({
        id: 'ol_remrun_abc',
      });
    });
  });

  describe('getStatus', () => {
    it('should surface a failed run with its detail', async () => {
      runs.getRun.mockResolvedValue({ ...RUN, status: 'failed', detail: '2 orders remain' });

      await expect(controller.getStatus('ol_remrun_abc')).resolves.toMatchObject({
        status: 'failed',
        detail: '2 orders remain',
      });
    });

    it('should 404 an unknown run id', async () => {
      runs.getRun.mockResolvedValue(null);

      await expect(controller.getStatus('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getAffectedOrders', () => {
    it('should page the affected list and project each row', async () => {
      orderRecordService.getCurrencyMismatchOrders.mockResolvedValue({
        items: [
          {
            internalOrderId: 'ol_order_a',
            sourceConnectionId: 'conn-1',
            nativeCurrency: 'PLN',
            stampedCurrency: 'USD',
            stampedAt: new Date('2026-08-20T00:00:00Z'),
          },
        ],
        total: 1,
      });

      const response = await controller.getAffectedOrders({ ...body, limit: 10, offset: 5 });

      expect(orderRecordService.getCurrencyMismatchOrders).toHaveBeenCalledWith(
        expect.anything(),
        'EUR',
        { limit: 10, offset: 5 }
      );
      expect(response.total).toBe(1);
      expect(response.items[0]).toMatchObject({
        internalOrderId: 'ol_order_a',
        stampedCurrency: 'USD',
      });
    });

    it('should default the page size when the caller omits pagination', async () => {
      orderRecordService.getCurrencyMismatchOrders.mockResolvedValue({ items: [], total: 0 });

      await controller.getAffectedOrders(body);

      expect(orderRecordService.getCurrencyMismatchOrders).toHaveBeenCalledWith(
        expect.anything(),
        'EUR',
        { limit: 25, offset: 0 }
      );
    });
  });
});
