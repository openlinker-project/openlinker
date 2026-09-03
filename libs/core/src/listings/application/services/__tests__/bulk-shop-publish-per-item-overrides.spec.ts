/**
 * Bulk Shop Publish — per-item overrides end-to-end unit spec (#1831)
 *
 * Wires the REAL submit → enqueue → execution → builder chain (mocking only the
 * leaf ports) and bridges the enqueued payload into execution exactly as the
 * `shop.product.publish` worker handler does. Proves that per-item
 * `content` / `destinationCategoryIds` / `parameters` overrides survive the whole
 * bulk transport and land on the neutral `PublishProductCommand` the shop adapter
 * receives — beating the batch-shared content and the server-derived category
 * provisioning / attribute projection — while a passthrough item keeps the
 * batch-shared / server-derived defaults.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */

import { ListingCreationRecord } from '../../../domain/entities/listing-creation-record.entity';
import type { PublishProductCommand } from '../../../domain/types/product-publish.types';
import type { ShopProductPublishPayload } from '@openlinker/core/sync';
import { BulkShopPublishSubmitService } from '../bulk-shop-publish-submit.service';
import { ProductPublishBuilderService } from '../product-publish-builder.service';
import { ProductPublishEnqueueService } from '../product-publish-enqueue.service';
import { ProductPublishExecutionService } from '../product-publish-execution.service';

const CONN = 'conn-shop-1';
const MASTER = 'conn-master-1';
const USER = 'user-1';

describe('Bulk shop publish per-item overrides (end-to-end, #1831)', () => {
  it('lands per-item content/categories/parameters on the adapter command; passthrough keeps defaults', async () => {
    // --- leaf-port mocks -----------------------------------------------------
    const recordsById = new Map<string, ListingCreationRecord>();
    let recordSeq = 0;
    const listingRecords = {
      create: jest.fn((partial: { internalVariantId: string; connectionId: string; bulkBatchId?: string }) => {
        const id = `rec-${++recordSeq}`;
        const rec = new ListingCreationRecord(
          id,
          partial.internalVariantId,
          partial.connectionId,
          null,
          'pending',
          null,
          new Date(),
          new Date(),
          partial.bulkBatchId ?? null,
        );
        recordsById.set(id, rec);
        return Promise.resolve(rec);
      }),
      findById: jest.fn((id: string) => Promise.resolve(recordsById.get(id) ?? null)),
      updateExternalIdAndStatus: jest.fn(
        (id: string, externalProductId: string, status: 'draft' | 'published') => {
          const prev = recordsById.get(id)!;
          const updated = new ListingCreationRecord(
            prev.id,
            prev.internalVariantId,
            prev.connectionId,
            externalProductId,
            status,
            null,
            prev.createdAt,
            new Date(),
            prev.bulkBatchId,
          );
          recordsById.set(id, updated);
          return Promise.resolve(updated);
        },
      ),
      updateStatus: jest.fn(),
      findByBulkBatchId: jest.fn(),
    };

    const capturedPayloads: ShopProductPublishPayload[] = [];
    const jobEnqueue = {
      enqueueJob: jest.fn((job: { payload: ShopProductPublishPayload }) => {
        capturedPayloads.push(job.payload);
        return Promise.resolve({ jobId: `job-${capturedPayloads.length}` });
      }),
    };

    const bulkBatchRepository = {
      create: jest.fn().mockResolvedValue({ id: 'batch-1', totalCount: 2 }),
      updateStatus: jest.fn().mockResolvedValue({ id: 'batch-1' }),
      findById: jest.fn(),
    };

    const capturedCommands: PublishProductCommand[] = [];
    const shopAdapter = {
      publishProduct: jest.fn((command: PublishProductCommand) => {
        capturedCommands.push(command);
        return Promise.resolve({ externalProductId: 'ext-1', status: command.status });
      }),
      // A provisioner is available — a passthrough item must still provision.
      provisionCategory: jest.fn().mockResolvedValue({ destinationCategoryId: 'dest-provisioned' }),
    };
    const productMaster = {
      getProduct: jest.fn().mockResolvedValue({
        name: 'Master name',
        description: 'Master description',
        images: ['http://master-img'],
        price: 20,
        currency: 'PLN',
      }),
      getProductCategories: jest
        .fn()
        .mockResolvedValue([{ id: 'src-root', name: 'Electronics', depth: 0 }]),
    };
    const integrations = {
      getCapabilityAdapter: jest.fn((_id: string, capability: string) =>
        capability === 'ProductMaster'
          ? Promise.resolve(productMaster)
          : Promise.resolve(shopAdapter),
      ),
    };

    const productsService = {
      getVariant: jest.fn().mockResolvedValue({
        id: 'v',
        productId: 'prod-1',
        attributes: { Brand: 'Acme' },
        ean: null,
        gtin: null,
        sku: null,
      }),
      // Single-element ⇒ variantGroup stays absent (#1836); this suite is not
      // exercising the multi-variant grouped path.
      getVariantsByProductId: jest
        .fn()
        .mockResolvedValue([{ id: 'v', productId: 'prod-1', attributes: { Brand: 'Acme' } }]),
    };
    const connectionPort = {
      get: jest.fn().mockResolvedValue({ config: { masterCatalogConnectionId: MASTER } }),
    };
    const attributeProjection = {
      project: jest.fn().mockResolvedValue({
        parameters: [{ id: 'Brand', values: ['Acme'], section: 'product' }],
        unmappedSourceKeys: [],
        unresolvedRequired: [], restrictionIssues: [],
      }),
    };
    const identifierMapping = {
      getExternalIds: jest.fn().mockResolvedValue([]),
      createMapping: jest.fn().mockResolvedValue(undefined),
    };

    // --- real service graph --------------------------------------------------
    const builder = new ProductPublishBuilderService(
      productsService as never,
      connectionPort as never,
      integrations as never,
      attributeProjection as never,
      {
        // #2323 - the seam owns the buffer; these fixtures configure none, so
        // the quantity passes through exactly as it did pre-rewire.
        applyPublishControls: ({ quantity }: { quantity: number }) =>
          Promise.resolve({ quantity: Math.max(0, quantity), provenance: 'computed' }),
      } as never,
    );
    const execution = new ProductPublishExecutionService(
      builder as never,
      listingRecords as never,
      identifierMapping as never,
      integrations as never,
    );
    const enqueue = new ProductPublishEnqueueService(
      integrations as never,
      listingRecords as never,
      jobEnqueue as never,
    );
    const submit = new BulkShopPublishSubmitService(
      integrations as never,
      bulkBatchRepository as never,
      enqueue as never,
      listingRecords as never,
    );

    // --- submit a batch: one overriding item, one passthrough ----------------
    const itemContent = { title: 'Per-item title' };
    const itemParameters = [{ id: 'Colour', values: ['Red'], section: 'product' as const }];
    await submit.submit({
      connectionId: CONN,
      initiatedBy: USER,
      status: 'published',
      content: { title: 'Batch title' },
      items: [
        {
          internalVariantId: 'v-override',
          stock: 3,
          content: itemContent,
          destinationCategoryIds: ['cat-override'],
          parameters: itemParameters,
        },
        { internalVariantId: 'v-passthrough', stock: 5 },
      ],
    });

    expect(capturedPayloads).toHaveLength(2);

    // --- bridge each payload into execution, mirroring the worker handler ----
    for (const payload of capturedPayloads) {
      await execution.executePublish({
        internalVariantId: payload.internalVariantId,
        connectionId: CONN,
        stock: payload.stock,
        status: payload.status,
        price: payload.price,
        content: payload.content,
        commerce: payload.commerce,
        destinationCategoryIds: payload.destinationCategoryIds,
        parameters: payload.parameters,
        idempotencyKey: payload.idempotencyKey,
        listingCreationRecordId: payload.listingCreationRecordId,
      });
    }

    expect(capturedCommands).toHaveLength(2);
    const overrideCmd = capturedCommands.find((c) => c.internalVariantId === 'v-override')!;
    const passthroughCmd = capturedCommands.find((c) => c.internalVariantId === 'v-passthrough')!;

    // Overriding item: per-item content beat the batch-shared "Batch title";
    // per-item categories/parameters beat provisioning + projection.
    expect(overrideCmd.content?.title).toBe('Per-item title');
    expect(overrideCmd.destinationCategoryIds).toEqual(['cat-override']);
    expect(overrideCmd.parameters).toEqual(itemParameters);

    // Passthrough item: batch-shared content applied; category provisioned +
    // attributes projected server-side (the defaults).
    expect(passthroughCmd.content?.title).toBe('Batch title');
    expect(passthroughCmd.destinationCategoryIds).toEqual(['dest-provisioned']);
    expect(passthroughCmd.parameters).toEqual([{ id: 'Brand', values: ['Acme'], section: 'product' }]);

    // The overriding item must NOT have triggered provisioning or projection.
    expect(shopAdapter.provisionCategory).toHaveBeenCalledTimes(1);
    expect(attributeProjection.project).toHaveBeenCalledTimes(1);
  });
});
