/**
 * Marketplace Offer Create Handler Tests
 *
 * Covers both V1 (single-offer) and V2 (bulk-aware) payload paths and the
 * two V2 side-effects the handler owns: AI description prep and
 * BulkListingProgressService counter advancement.
 *
 * Smart classification readback was moved into OfferCreationExecutionService
 * (so the handler stays cross-context-clean — no repository-port imports).
 * Smart-readback test coverage lives in
 * `libs/core/src/listings/application/services/__tests__/offer-creation-execution.service.spec.ts`
 * and `offer-status-poll.service.spec.ts`.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { MarketplaceOfferCreateHandler } from '../marketplace-offer-create.handler';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import {
  OfferCreationRecord,
  type IBulkListingProgressService,
  type IOfferCreationExecutionService,
} from '@openlinker/core/listings';
import type { IContentSuggestionService } from '@openlinker/core/content';
import type { IProductsService } from '@openlinker/core/products';

const VARIANT_ID = 'ol_variant_123';
const PRODUCT_ID = 'ol_product_456';
const CONNECTION_ID = 'conn-allegro';
const JOB_ID = 'job-1';
const RECORD_ID = 'rec-1';
const EXTERNAL_OFFER_ID = 'allegro-offer-1';
const BATCH_ID = 'batch-uuid-1';

const buildRecord = (overrides: Partial<OfferCreationRecord> = {}): OfferCreationRecord => {
  const now = new Date('2026-01-01T00:00:00Z');
  return new OfferCreationRecord(
    overrides.id ?? RECORD_ID,
    overrides.internalVariantId ?? VARIANT_ID,
    overrides.connectionId ?? CONNECTION_ID,
    overrides.externalOfferId ?? null,
    overrides.status ?? 'draft',
    overrides.errors ?? null,
    overrides.publishImmediately ?? false,
    overrides.createdAt ?? now,
    overrides.updatedAt ?? now,
    overrides.request ?? null,
    overrides.bulkBatchId ?? null,
    overrides.classificationReport ?? null
  );
};

describe('MarketplaceOfferCreateHandler', () => {
  let handler: MarketplaceOfferCreateHandler;
  let offerCreation: jest.Mocked<IOfferCreationExecutionService>;
  let contentSuggestion: jest.Mocked<IContentSuggestionService>;
  let products: jest.Mocked<IProductsService>;
  let bulkProgress: jest.Mocked<IBulkListingProgressService>;

  beforeEach(() => {
    offerCreation = {
      executeCreation: jest.fn(),
    } as unknown as jest.Mocked<IOfferCreationExecutionService>;

    contentSuggestion = {
      suggestDescription: jest.fn(),
    } as unknown as jest.Mocked<IContentSuggestionService>;

    products = {
      getVariant: jest.fn(),
    } as unknown as jest.Mocked<IProductsService>;

    bulkProgress = {
      advanceBatchStatus: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<IBulkListingProgressService>;

    handler = new MarketplaceOfferCreateHandler(
      offerCreation,
      contentSuggestion,
      products,
      bulkProgress
    );
  });

  const createJob = (payload: Record<string, unknown> | undefined): SyncJob => ({
    id: JOB_ID,
    jobType: 'marketplace.offer.create' as unknown as SyncJob['jobType'],
    connectionId: CONNECTION_ID,
    payload: payload as never,
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

  // ---------- V1 payload path ----------

  describe('V1 payload (single-offer)', () => {
    it('delegates to the execution service with parsed payload + job connection id', async () => {
      offerCreation.executeCreation.mockResolvedValue({
        offerCreationRecord: buildRecord({ status: 'draft', externalOfferId: 'allegro-1' }),
        outcome: 'ok',
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

      const result = await handler.execute(job);

      expect(result).toEqual({ outcome: 'ok' });
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
      // V1 must not call any V2-only side-effects.
      expect(contentSuggestion.suggestDescription).not.toHaveBeenCalled();
      expect(bulkProgress.advanceBatchStatus).not.toHaveBeenCalled();
    });

    it('returns outcome=business_failure when the service records a terminal failure', async () => {
      offerCreation.executeCreation.mockResolvedValue({
        offerCreationRecord: buildRecord({
          status: 'failed',
          errors: [{ field: 'price.amount', code: 'REQUIRED', message: 'Required' }],
        }),
        outcome: 'business_failure',
      });

      const job = createJob({
        schemaVersion: 1,
        internalVariantId: VARIANT_ID,
        stock: 3,
        publishImmediately: false,
      });

      await expect(handler.execute(job)).resolves.toEqual({ outcome: 'business_failure' });
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
      const job = createJob(undefined);
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
        schemaVersion: 99,
        internalVariantId: VARIANT_ID,
        stock: 1,
        publishImmediately: false,
      });
      await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
      expect(offerCreation.executeCreation).not.toHaveBeenCalled();
    });
  });

  // ---------- V2 payload path ----------

  describe('V2 payload (bulk-aware)', () => {
    const baseV2 = (overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
      schemaVersion: 2,
      internalVariantId: VARIANT_ID,
      stock: 1,
      publishImmediately: false,
      offerCreationRecordId: RECORD_ID,
      bulkBatchId: BATCH_ID,
      generateDescription: false,
      ...overrides,
    });

    it('threads AI-generated description into overrides when generateDescription=true', async () => {
      products.getVariant.mockResolvedValue({
        id: VARIANT_ID,
        productId: PRODUCT_ID,
      } as never);
      contentSuggestion.suggestDescription.mockResolvedValue({
        suggestion: '<p>AI-built description</p>',
      } as never);
      offerCreation.executeCreation.mockResolvedValue({
        offerCreationRecord: buildRecord({
          status: 'active',
          externalOfferId: EXTERNAL_OFFER_ID,
          bulkBatchId: BATCH_ID,
        }),
        outcome: 'ok',
      });

      const job = createJob(
        baseV2({
          generateDescription: true,
          overrides: { title: 'Operator Title' },
          descriptionTone: 'professional',
        })
      );

      await handler.execute(job);

      expect(products.getVariant).toHaveBeenCalledWith(VARIANT_ID);
      expect(contentSuggestion.suggestDescription).toHaveBeenCalledWith({
        productId: PRODUCT_ID,
        channel: 'allegro',
        tone: 'professional',
      });
      expect(offerCreation.executeCreation).toHaveBeenCalledWith(
        expect.objectContaining({
          overrides: { title: 'Operator Title', description: '<p>AI-built description</p>' },
        })
      );
    });

    it('falls through with operator overrides when AI suggestion fails', async () => {
      products.getVariant.mockResolvedValue({
        id: VARIANT_ID,
        productId: PRODUCT_ID,
      } as never);
      contentSuggestion.suggestDescription.mockRejectedValue(new Error('LLM 503'));
      offerCreation.executeCreation.mockResolvedValue({
        offerCreationRecord: buildRecord({ status: 'failed' }),
        outcome: 'business_failure',
      });

      const job = createJob(
        baseV2({
          generateDescription: true,
          overrides: { title: 'Operator Title' },
        })
      );

      await handler.execute(job);

      // The fallback is operator overrides — description not added by AI.
      expect(offerCreation.executeCreation).toHaveBeenCalledWith(
        expect.objectContaining({
          overrides: { title: 'Operator Title' },
        })
      );
    });

    it('falls through when variant lookup fails (AI skipped, no throw)', async () => {
      products.getVariant.mockRejectedValue(new Error('DB blip'));
      offerCreation.executeCreation.mockResolvedValue({
        offerCreationRecord: buildRecord({ status: 'failed' }),
        outcome: 'business_failure',
      });

      const job = createJob(baseV2({ generateDescription: true, overrides: { title: 'X' } }));

      await handler.execute(job);

      expect(contentSuggestion.suggestDescription).not.toHaveBeenCalled();
      expect(offerCreation.executeCreation).toHaveBeenCalledWith(
        expect.objectContaining({ overrides: { title: 'X' } })
      );
    });

    it('does not invoke AI when generateDescription=false', async () => {
      offerCreation.executeCreation.mockResolvedValue({
        offerCreationRecord: buildRecord({
          status: 'active',
          externalOfferId: EXTERNAL_OFFER_ID,
        }),
        outcome: 'ok',
      });

      const job = createJob(baseV2({ generateDescription: false }));

      await handler.execute(job);

      expect(products.getVariant).not.toHaveBeenCalled();
      expect(contentSuggestion.suggestDescription).not.toHaveBeenCalled();
    });

    it('advances batch with succeeded on outcome=ok', async () => {
      offerCreation.executeCreation.mockResolvedValue({
        offerCreationRecord: buildRecord({
          status: 'active',
          externalOfferId: EXTERNAL_OFFER_ID,
        }),
        outcome: 'ok',
      });

      const job = createJob(baseV2());

      await handler.execute(job);

      expect(bulkProgress.advanceBatchStatus).toHaveBeenCalledWith(
        BATCH_ID,
        RECORD_ID,
        'succeeded'
      );
    });

    it('advances batch with failed on outcome=business_failure', async () => {
      offerCreation.executeCreation.mockResolvedValue({
        offerCreationRecord: buildRecord({
          status: 'failed',
          externalOfferId: null,
          errors: [{ code: 'X', message: 'y' }],
        }),
        outcome: 'business_failure',
      });

      const job = createJob(baseV2());

      await handler.execute(job);

      expect(bulkProgress.advanceBatchStatus).toHaveBeenCalledWith(BATCH_ID, RECORD_ID, 'failed');
    });

    it('throws SyncJobExecutionError when bulkBatchId is missing', async () => {
      const job = createJob(baseV2({ bulkBatchId: undefined }));
      await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
      expect(offerCreation.executeCreation).not.toHaveBeenCalled();
    });

    it('throws SyncJobExecutionError when offerCreationRecordId is missing', async () => {
      const job = createJob(baseV2({ offerCreationRecordId: undefined }));
      await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
    });

    it('throws SyncJobExecutionError when generateDescription is missing', async () => {
      const job = createJob(baseV2({ generateDescription: undefined }));
      await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
    });
  });
});
