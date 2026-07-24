/**
 * Shop Product Publish Handler — unit spec
 *
 * Covers payload validation (schemaVersion / variant / stock / status),
 * delegation to the execution service, and outcome passthrough.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJob } from '@openlinker/core/sync';

import { ShopProductPublishHandler } from '../shop-product-publish.handler';

const CONN = 'conn-shop-1';

function createJob(payload: unknown): SyncJob {
  return {
    id: 'job-1',
    jobType: 'shop.product.publish',
    connectionId: CONN,
    payload: payload as Record<string, unknown>,
    status: 'running',
    attempts: 1,
    maxAttempts: 3,
    nextRunAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as SyncJob;
}

const validPayload = {
  schemaVersion: 1,
  internalVariantId: 'ol_variant_aaaa',
  status: 'published',
  stock: 5,
};

describe('ShopProductPublishHandler', () => {
  let execution: { executePublish: jest.Mock };
  let bulkProgress: { advanceBatchStatus: jest.Mock };
  let contentSuggestion: { suggestDescription: jest.Mock };
  let products: { getVariant: jest.Mock };
  let handler: ShopProductPublishHandler;

  beforeEach(() => {
    execution = {
      executePublish: jest.fn().mockResolvedValue({
        listingCreationRecord: { id: 'rec-1', status: 'published', externalProductId: 'wc-1' },
        outcome: 'ok',
      }),
    };
    bulkProgress = { advanceBatchStatus: jest.fn().mockResolvedValue(null) };
    contentSuggestion = { suggestDescription: jest.fn() };
    products = { getVariant: jest.fn() };
    handler = new ShopProductPublishHandler(
      execution as never,
      bulkProgress as never,
      contentSuggestion as never,
      products as never,
    );
  });

  it('should delegate a valid payload to the execution service and return its outcome', async () => {
    const result = await handler.execute(createJob(validPayload));

    expect(execution.executePublish).toHaveBeenCalledWith(
      expect.objectContaining({
        internalVariantId: 'ol_variant_aaaa',
        connectionId: CONN,
        stock: 5,
        status: 'published',
      }),
    );
    expect(result).toEqual({ outcome: 'ok' });
  });

  it('should not advance any batch for a V1 (single) payload', async () => {
    await handler.execute(createJob(validPayload));
    expect(bulkProgress.advanceBatchStatus).not.toHaveBeenCalled();
  });

  it('should advance the parent batch counter for a V2 bulk payload', async () => {
    const v2 = {
      ...validPayload,
      schemaVersion: 2,
      bulkBatchId: 'batch-1',
      listingCreationRecordId: 'rec-1',
    };
    await handler.execute(createJob(v2));
    expect(bulkProgress.advanceBatchStatus).toHaveBeenCalledWith('batch-1', 'rec-1', 'succeeded');
  });

  it('should advance "failed" when a V2 child publish is a business_failure', async () => {
    execution.executePublish.mockResolvedValue({
      listingCreationRecord: { id: 'rec-1', status: 'failed', externalProductId: null },
      outcome: 'business_failure',
    });
    const v2 = {
      ...validPayload,
      schemaVersion: 2,
      bulkBatchId: 'batch-1',
      listingCreationRecordId: 'rec-1',
    };
    await handler.execute(createJob(v2));
    expect(bulkProgress.advanceBatchStatus).toHaveBeenCalledWith('batch-1', 'rec-1', 'failed');
  });

  it('should reject a V2 payload missing bulkBatchId', async () => {
    const bad = { ...validPayload, schemaVersion: 2, listingCreationRecordId: 'rec-1' };
    await expect(handler.execute(createJob(bad))).rejects.toBeInstanceOf(SyncJobExecutionError);
    expect(execution.executePublish).not.toHaveBeenCalled();
  });

  it('should pass through a business_failure outcome', async () => {
    execution.executePublish.mockResolvedValue({
      listingCreationRecord: { id: 'rec-1', status: 'failed', externalProductId: null },
      outcome: 'business_failure',
    });
    const result = await handler.execute(createJob(validPayload));
    expect(result).toEqual({ outcome: 'business_failure' });
  });

  it.each([
    ['unsupported schemaVersion', { ...validPayload, schemaVersion: 2 }],
    ['missing internalVariantId', { ...validPayload, internalVariantId: '' }],
    ['invalid stock', { ...validPayload, stock: -1 }],
    ['invalid status', { ...validPayload, status: 'active' }],
  ])('should reject %s', async (_label, payload) => {
    await expect(handler.execute(createJob(payload))).rejects.toBeInstanceOf(SyncJobExecutionError);
    expect(execution.executePublish).not.toHaveBeenCalled();
  });

  it('should wrap a transient execution error as SyncJobExecutionError', async () => {
    execution.executePublish.mockRejectedValue(new Error('redis down'));
    await expect(handler.execute(createJob(validPayload))).rejects.toBeInstanceOf(
      SyncJobExecutionError,
    );
  });

  describe('AI description (#1840)', () => {
    it('should not invoke AI when generateDescription is absent', async () => {
      await handler.execute(createJob(validPayload));
      expect(products.getVariant).not.toHaveBeenCalled();
      expect(contentSuggestion.suggestDescription).not.toHaveBeenCalled();
    });

    it('should generate and fill content.description when generateDescription=true', async () => {
      products.getVariant.mockResolvedValue({ id: 'ol_variant_aaaa', productId: 'ol_product_x' });
      contentSuggestion.suggestDescription.mockResolvedValue({ suggestion: '<p>AI copy</p>' });

      await handler.execute(
        createJob({ ...validPayload, generateDescription: true, descriptionTone: 'detailed' }),
      );

      expect(products.getVariant).toHaveBeenCalledWith('ol_variant_aaaa');
      expect(contentSuggestion.suggestDescription).toHaveBeenCalledWith({
        productId: 'ol_product_x',
        channel: 'woocommerce',
        tone: 'detailed',
      });
      expect(execution.executePublish).toHaveBeenCalledWith(
        expect.objectContaining({ content: { description: '<p>AI copy</p>' } }),
      );
    });

    it('should not overwrite an explicit operator description override', async () => {
      await handler.execute(
        createJob({
          ...validPayload,
          generateDescription: true,
          content: { description: 'operator wrote this' },
        }),
      );

      expect(contentSuggestion.suggestDescription).not.toHaveBeenCalled();
      expect(execution.executePublish).toHaveBeenCalledWith(
        expect.objectContaining({ content: { description: 'operator wrote this' } }),
      );
    });

    it('should merge the AI description alongside other operator content fields', async () => {
      products.getVariant.mockResolvedValue({ id: 'ol_variant_aaaa', productId: 'ol_product_x' });
      contentSuggestion.suggestDescription.mockResolvedValue({ suggestion: '<p>AI copy</p>' });

      await handler.execute(
        createJob({
          ...validPayload,
          generateDescription: true,
          content: { title: 'Keep me' },
        }),
      );

      expect(execution.executePublish).toHaveBeenCalledWith(
        expect.objectContaining({ content: { title: 'Keep me', description: '<p>AI copy</p>' } }),
      );
    });

    it('should fall through to the original content when the AI call fails', async () => {
      products.getVariant.mockResolvedValue({ id: 'ol_variant_aaaa', productId: 'ol_product_x' });
      contentSuggestion.suggestDescription.mockRejectedValue(new Error('LLM 503'));

      const result = await handler.execute(
        createJob({ ...validPayload, generateDescription: true }),
      );

      expect(result).toEqual({ outcome: 'ok' });
      expect(execution.executePublish).toHaveBeenCalledWith(
        expect.objectContaining({ content: undefined }),
      );
    });

    it('should fall through when the variant cannot be resolved', async () => {
      products.getVariant.mockResolvedValue(null);

      await handler.execute(createJob({ ...validPayload, generateDescription: true }));

      expect(contentSuggestion.suggestDescription).not.toHaveBeenCalled();
      expect(execution.executePublish).toHaveBeenCalledWith(
        expect.objectContaining({ content: undefined }),
      );
    });
  });
});
