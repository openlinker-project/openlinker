/**
 * Price Change Apply Handler tests (#3144, ADR-072)
 *
 * The handler is a thin shell (#3161 review) — payload parsing, delegation to
 * `IPriceChangeApplyService`, and wrapping a thrown error into
 * `SyncJobExecutionError`. All orchestration behavior (capability selection,
 * episode resolution, auto-applied-log semantics, business-failure
 * classification, …) is covered by
 * `libs/core/src/listings/application/services/__tests__/price-change-apply.service.spec.ts`.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { PriceChangeApplyHandler } from '../price-change-apply.handler';

interface FakeSyncJob {
  id: string;
  jobType: string;
  connectionId: string;
  payload: Record<string, unknown>;
}

function buildJob(payload: Record<string, unknown>): FakeSyncJob {
  return {
    id: 'job-1',
    jobType: 'pricing.propagateToMarketplaces',
    connectionId: 'dest-1',
    payload,
  };
}

function runHandler(
  handler: PriceChangeApplyHandler,
  payload: Record<string, unknown>
): ReturnType<PriceChangeApplyHandler['execute']> {
  return handler.execute(buildJob(payload) as never);
}

describe('PriceChangeApplyHandler', () => {
  let priceChangeApply: { applyPriceChange: jest.Mock };
  let handler: PriceChangeApplyHandler;

  const validPayload = {
    productVariantId: 'ol_variant_1',
    destinationConnectionId: 'dest-1',
    sourceConnectionId: 'src-1',
    amount: 399,
    currency: 'PLN',
    automatic: true,
  };

  beforeEach(() => {
    priceChangeApply = { applyPriceChange: jest.fn().mockResolvedValue({ outcome: 'ok' }) };
    handler = new PriceChangeApplyHandler(priceChangeApply as never);
  });

  it('delegates to IPriceChangeApplyService with the parsed payload', async () => {
    const result = await runHandler(handler, validPayload);

    expect(result).toEqual({ outcome: 'ok' });
    expect(priceChangeApply.applyPriceChange).toHaveBeenCalledWith(
      expect.objectContaining({
        productVariantId: 'ol_variant_1',
        destinationConnectionId: 'dest-1',
        sourceConnectionId: 'src-1',
        amount: 399,
        currency: 'PLN',
        automatic: true,
      })
    );
  });

  it('passes through a business_failure outcome without throwing', async () => {
    priceChangeApply.applyPriceChange.mockResolvedValue({
      outcome: 'business_failure',
      reason: 'blocked',
    });

    const result = await runHandler(handler, validPayload);

    expect(result).toEqual({ outcome: 'business_failure' });
  });

  it('wraps a thrown error in SyncJobExecutionError, preserving it as cause', async () => {
    const cause = new Error('rate limited');
    priceChangeApply.applyPriceChange.mockRejectedValue(cause);

    await expect(runHandler(handler, validPayload)).rejects.toBeInstanceOf(SyncJobExecutionError);
    try {
      await runHandler(handler, validPayload);
      fail('expected a throw');
    } catch (error) {
      expect((error as SyncJobExecutionError).cause).toBe(cause);
    }
  });

  it('threads episodeId / manualPriceOverride / resolvedByUserId / batchId through when present', async () => {
    await runHandler(handler, {
      ...validPayload,
      automatic: false,
      episodeId: 'ep-1',
      manualPriceOverride: true,
      resolvedByUserId: 'user-1',
      batchId: 'batch-1',
    });

    expect(priceChangeApply.applyPriceChange).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeId: 'ep-1',
        manualPriceOverride: true,
        resolvedByUserId: 'user-1',
        batchId: 'batch-1',
      })
    );
  });

  it('throws for a missing required payload field', async () => {
    await expect(runHandler(handler, {})).rejects.toBeInstanceOf(SyncJobExecutionError);
    expect(priceChangeApply.applyPriceChange).not.toHaveBeenCalled();
  });

  it('throws for a non-finite amount', async () => {
    await expect(
      runHandler(handler, { ...validPayload, amount: Number.NaN })
    ).rejects.toBeInstanceOf(SyncJobExecutionError);
  });
});
