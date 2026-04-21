/**
 * Marketplace Offer Create Handler Tests
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { MarketplaceOfferCreateHandler } from '../marketplace-offer-create.handler';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { SyncJob } from '@openlinker/core/sync/domain/entities/sync-job.entity';
import { OfferCreationRecord } from '@openlinker/core/listings';
import type { IOfferCreationExecutionService } from '@openlinker/core/listings';

const VARIANT_ID = 'ol_variant_123';
const CONNECTION_ID = 'conn-allegro';
const JOB_ID = 'job-1';

const buildRecord = (overrides: Partial<OfferCreationRecord> = {}): OfferCreationRecord => {
  const now = new Date('2026-01-01T00:00:00Z');
  return new OfferCreationRecord(
    overrides.id ?? 'rec-1',
    overrides.internalVariantId ?? VARIANT_ID,
    overrides.connectionId ?? CONNECTION_ID,
    overrides.externalOfferId ?? null,
    overrides.status ?? 'draft',
    overrides.errors ?? null,
    overrides.publishImmediately ?? false,
    overrides.createdAt ?? now,
    overrides.updatedAt ?? now,
  );
};

describe('MarketplaceOfferCreateHandler', () => {
  let handler: MarketplaceOfferCreateHandler;
  let offerCreation: jest.Mocked<IOfferCreationExecutionService>;

  beforeEach(() => {
    offerCreation = {
      executeCreation: jest.fn(),
    };
    handler = new MarketplaceOfferCreateHandler(offerCreation);
  });

  const createJob = (payload: Record<string, unknown>): SyncJob => ({
    id: JOB_ID,
    jobType: 'marketplace.offer.create' as unknown as SyncJob['jobType'],
    connectionId: CONNECTION_ID,
    payload,
    idempotencyKey: 'idem-key',
    status: 'queued',
    attempts: 0,
    maxAttempts: 10,
    nextRunAt: new Date(),
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('delegates to the execution service with parsed payload + job connection id', async () => {
    offerCreation.executeCreation.mockResolvedValue({
      offerCreationRecord: buildRecord({ status: 'draft', externalOfferId: 'allegro-1' }),
    });

    const job = createJob({
      schemaVersion: 1,
      internalVariantId: VARIANT_ID,
      stock: 3,
      publishImmediately: true,
      price: { amount: 49.99, currency: 'PLN' },
      overrides: { title: 'Hello' },
      idempotencyKey: 'idem-1',
    });

    await handler.execute(job);

    expect(offerCreation.executeCreation).toHaveBeenCalledWith({
      internalVariantId: VARIANT_ID,
      connectionId: CONNECTION_ID,
      stock: 3,
      publishImmediately: true,
      price: { amount: 49.99, currency: 'PLN' },
      overrides: { title: 'Hello' },
      idempotencyKey: 'idem-1',
      offerCreationRecordId: undefined,
    });
  });

  it('returns normally when the service records a terminal failure', async () => {
    offerCreation.executeCreation.mockResolvedValue({
      offerCreationRecord: buildRecord({
        status: 'failed',
        errors: [{ field: 'price.amount', code: 'REQUIRED', message: 'Required' }],
      }),
    });

    const job = createJob({
      schemaVersion: 1,
      internalVariantId: VARIANT_ID,
      stock: 3,
      publishImmediately: false,
    });

    await expect(handler.execute(job)).resolves.toBeUndefined();
  });

  it('wraps unknown service errors in SyncJobExecutionError for retry', async () => {
    offerCreation.executeCreation.mockRejectedValue(new Error('redis down'));

    const job = createJob({
      schemaVersion: 1,
      internalVariantId: VARIANT_ID,
      stock: 1,
      publishImmediately: false,
    });

    await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('throws SyncJobExecutionError when payload is missing', async () => {
    const job = createJob(undefined as unknown as Record<string, unknown>);
    await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
    expect(offerCreation.executeCreation).not.toHaveBeenCalled();
  });

  it('throws SyncJobExecutionError when internalVariantId is missing', async () => {
    const job = createJob({ schemaVersion: 1, stock: 1, publishImmediately: false });
    await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
    expect(offerCreation.executeCreation).not.toHaveBeenCalled();
  });

  it('throws SyncJobExecutionError when stock is missing or negative', async () => {
    const job = createJob({
      schemaVersion: 1,
      internalVariantId: VARIANT_ID,
      stock: -1,
      publishImmediately: false,
    });
    await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('throws SyncJobExecutionError when schemaVersion is unsupported', async () => {
    const job = createJob({
      schemaVersion: 2,
      internalVariantId: VARIANT_ID,
      stock: 1,
      publishImmediately: false,
    });
    await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
    expect(offerCreation.executeCreation).not.toHaveBeenCalled();
  });
});
