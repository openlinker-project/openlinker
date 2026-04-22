/**
 * Marketplace Offers Sync End-to-End Integration Test
 *
 * Validates offer mapping population and follow-up job enqueueing.
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations/integrations.tokens';
import { OfferManagerPort } from '@openlinker/core/listings';
import { IIntegrationsService } from '@openlinker/core/integrations';
import { JOB_ENQUEUE_TOKEN, SyncJobRepositoryPort } from '@openlinker/core/sync';
import { JobEnqueuePort } from '@openlinker/core/sync/domain/ports/job-enqueue.port';
import { SYNC_JOB_REPOSITORY_TOKEN } from '@openlinker/core/sync';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

describe('Marketplace Offers Sync End-to-End Integration', () => {
  let harness: WorkerIntegrationTestHarness;
  let integrationsService: IIntegrationsService;
  let jobRepository: SyncJobRepositoryPort;
  let jobEnqueue: JobEnqueuePort;
  let dataSource: DataSource;

  beforeAll(async () => {
    harness = await getTestHarness();
    integrationsService = harness.get(INTEGRATIONS_SERVICE_TOKEN);
    jobRepository = harness.get(SYNC_JOB_REPOSITORY_TOKEN);
    jobEnqueue = harness.get(JOB_ENQUEUE_TOKEN);
    dataSource = harness.getDataSource();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('creates Offer mappings and enqueues follow-up job', async () => {
    const connection = await createTestConnection(dataSource, {
      platformType: 'allegro',
      status: 'active',
      adapterKey: 'allegro.publicapi.v1',
    });

    const productRepo = dataSource.getRepository(ProductOrmEntity);
    const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);

    const product = productRepo.create({
      id: 'ol_product_1',
      name: 'Test Product',
      sku: null,
      price: null,
      description: null,
      images: null,
    });
    await productRepo.save(product);

    const variant = variantRepo.create({
      id: 'ol_variant_1',
      productId: product.id,
      sku: 'SKU-1',
      attributes: {},
    });
    await variantRepo.save(variant);

    const mockMarketplaceAdapter: OfferManagerPort = {
      updateOfferQuantity: jest.fn(),
      listOffers: jest.fn().mockResolvedValue({
        items: [{ offerId: 'offer-1', externalRef: 'SKU-1' }],
        nextCursor: '10',
      }),
    };

    jest.spyOn(integrationsService, 'getCapabilityAdapter').mockImplementation(
      async (_connectionId: string, capability: string) => {
        if (capability === 'OfferManager') {
          return mockMarketplaceAdapter as unknown as OfferManagerPort;
        }
        throw new Error(`Unsupported capability: ${capability}`);
      },
    );

    const offersSyncJob = await jobRepository.createIfNotExistsByIdempotencyKey({
      jobType: 'marketplace.offers.sync',
      connectionId: connection.id,
      payload: {
        schemaVersion: 1,
        limit: 50,
        cursor: null,
      },
      idempotencyKey: `offers-sync-${randomUUID()}`,
      maxAttempts: 10,
    });

    const enqueueSpy = jest.spyOn(jobEnqueue, 'enqueueJob');
    const { MarketplaceOffersSyncHandler } = require('../../src/sync/handlers/marketplace-offers-sync.handler');
    const handler = harness.get(MarketplaceOffersSyncHandler);

    await handler.execute(offersSyncJob);

    const mappingRepo = dataSource.getRepository(IdentifierMappingOrmEntity);
    const offerMappings = await mappingRepo.find({
      where: { entityType: 'Offer', connectionId: connection.id },
    });

    expect(offerMappings).toHaveLength(1);
    expect(offerMappings[0]?.externalId).toBe('offer-1');
    expect(offerMappings[0]?.internalId).toBe('ol_variant_1');

    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'marketplace.offers.sync',
        connectionId: connection.id,
        payload: expect.objectContaining({
          cursor: '10',
          limit: 50,
        }),
      }),
    );
  });
});
