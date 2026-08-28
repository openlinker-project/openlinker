/**
 * Analytics Tax Remediation Controller — Unit Tests (#2469)
 *
 * @module apps/api/src/analytics/http
 */
import type { ITaxRateBackfillService } from '@openlinker/core/orders';
import { AnalyticsTaxRemediationController } from './analytics-tax-remediation.controller';

describe('AnalyticsTaxRemediationController (#2469)', () => {
  let backfill: jest.Mocked<ITaxRateBackfillService>;
  let controller: AnalyticsTaxRemediationController;

  beforeEach(() => {
    backfill = {
      backfillPage: jest.fn(),
      backfillOrders: jest.fn().mockResolvedValue({ scanned: 3, updated: 2 }),
    };
    controller = new AnalyticsTaxRemediationController(backfill);
  });

  it('delegates to the SAME resolution the scheduled sweep runs, never a parallel mechanism', async () => {
    const response = await controller.rerunBackfill({
      internalOrderIds: ['ol_order_a', 'ol_order_b'],
    });

    expect(backfill.backfillOrders).toHaveBeenCalledWith(['ol_order_a', 'ol_order_b']);
    expect(backfill.backfillPage).not.toHaveBeenCalled();
    expect(response).toEqual({ scanned: 3, updated: 2 });
  });

  it('collapses duplicate ids so the reported counts match the operator’s selection', async () => {
    await controller.rerunBackfill({
      internalOrderIds: ['ol_order_a', 'ol_order_a', 'ol_order_b'],
    });

    expect(backfill.backfillOrders).toHaveBeenCalledWith(['ol_order_a', 'ol_order_b']);
  });

  it('opens no remediation run and returns synchronously — a backfill attempt is idempotent', async () => {
    // Pinned as a test because the sibling currency action does the opposite,
    // and the Phase 1 decision doc scopes `analytics_remediation_runs` to that
    // category alone. The controller is not even given a ledger service.
    await controller.rerunBackfill({ internalOrderIds: ['ol_order_a'] });

    expect(
      Object.keys(controller as unknown as Record<string, unknown>).some((key) =>
        key.toLowerCase().includes('run')
      )
    ).toBe(false);
  });
});
