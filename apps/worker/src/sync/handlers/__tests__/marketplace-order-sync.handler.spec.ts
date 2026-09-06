/**
 * Marketplace Order Sync Handler Tests
 *
 * Covers the #2928 status/outcome mapping: a `MissingOrderItemMappingError`
 * carrying `recordStatus: 'source_deleted'` yields a terminal
 * `business_failure` (not retried, no further marketplace hydration), the
 * ordinary self-healing `awaiting_mapping` gap (no `recordStatus`, or any
 * other `recordStatus`) still wraps in a retryable `SyncJobExecutionError`,
 * and a normal sync yields `ok` — mirrors the `master_deleted` precedent in
 * `master-product-sync.handler.spec.ts`.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { MarketplaceOrderSyncHandler } from '../marketplace-order-sync.handler';
import type { IOrderIngestionService } from '@openlinker/core/orders';
import { MissingOrderItemMappingError } from '@openlinker/core/orders';
import type { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';

describe('MarketplaceOrderSyncHandler', () => {
  let handler: MarketplaceOrderSyncHandler;
  let orderIngestion: jest.Mocked<IOrderIngestionService>;

  beforeEach(() => {
    orderIngestion = {
      ingestOrders: jest.fn(),
      syncOrderFromSource: jest.fn(),
    };
    handler = new MarketplaceOrderSyncHandler(orderIngestion);
  });

  const createJob = (): SyncJob =>
    ({
      id: 'job-1',
      jobType: 'marketplace.order.sync',
      connectionId: 'conn-1',
      payload: { schemaVersion: 1, externalOrderId: 'ext-order-9' },
      idempotencyKey: 'key',
      status: 'queued',
      attempts: 0,
      maxAttempts: 10,
      nextRunAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as unknown as SyncJob;

  it('returns outcome=ok for a normal sync', async () => {
    orderIngestion.syncOrderFromSource.mockResolvedValueOnce([]);

    await expect(handler.execute(createJob())).resolves.toEqual({ outcome: 'ok' });
  });

  it('returns outcome=business_failure with outcomeReason=source_deleted and does NOT throw when item resolution fails on a source-deleted mapping', async () => {
    orderIngestion.syncOrderFromSource.mockRejectedValueOnce(
      new MissingOrderItemMappingError(
        'conn-1',
        { type: 'offer', externalId: 'offer-1' },
        'variant isStale',
        'source_deleted'
      )
    );

    await expect(handler.execute(createJob())).resolves.toEqual({
      outcome: 'business_failure',
      outcomeReason: 'source_deleted',
    });
  });

  it('still throws a retryable SyncJobExecutionError for the ordinary awaiting_mapping gap (no recordStatus)', async () => {
    orderIngestion.syncOrderFromSource.mockRejectedValueOnce(
      new MissingOrderItemMappingError(
        'conn-1',
        { type: 'offer', externalId: 'offer-1' },
        'identifier_mappings:Offer'
      )
    );

    await expect(handler.execute(createJob())).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('still throws a retryable SyncJobExecutionError for a MissingOrderItemMappingError carrying recordStatus=awaiting_mapping', async () => {
    orderIngestion.syncOrderFromSource.mockRejectedValueOnce(
      new MissingOrderItemMappingError(
        'conn-1',
        { type: 'offer', externalId: 'offer-1' },
        'identifier_mappings:Offer',
        'awaiting_mapping'
      )
    );

    await expect(handler.execute(createJob())).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('wraps a transient/unrelated error in a retryable SyncJobExecutionError', async () => {
    orderIngestion.syncOrderFromSource.mockRejectedValueOnce(new Error('upstream timeout'));

    await expect(handler.execute(createJob())).rejects.toBeInstanceOf(SyncJobExecutionError);
  });
});
