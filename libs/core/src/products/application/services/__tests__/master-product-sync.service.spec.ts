/**
 * Master Product Sync Service Tests
 *
 * Covers the master-deletion propagation added in #1599: the unconditional
 * variant-prune after a successful pull (emitting `master.variant.stale`), the
 * 404 branch (neutral `MasterProductNotFoundError` → mark all variants stale,
 * emit `master.product.stale`, `masterDeleted: true`, no upsert), and that a
 * transient failure rethrows unchanged.
 *
 * @module libs/core/src/products/application/services/__tests__
 */
import { MasterProductSyncService } from '../master-product-sync.service';
import { MasterProductNotFoundError } from '../../../domain/exceptions/master-product-not-found.error';
import {
  MASTER_DELETION_EVENT_STREAM,
  MASTER_PRODUCT_STALE_EVENT,
  MASTER_VARIANT_STALE_EVENT,
} from '../../../domain/types/master-deletion-events.types';
import type { IProductsService } from '../products.service.interface';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import type { EventPublisherPort } from '@openlinker/core/events';
import type { Product } from '../../../domain/entities/product.entity';
import type { ProductVariant } from '../../../domain/entities/product-variant.entity';
import type { ProductMasterPort } from '../../../domain/ports/product-master.port';

const connectionId = 'connection-1';
const externalId = 'ext-9';
const internalProductId = 'ol_product_abc';

function makeProduct(): Product {
  return { id: internalProductId, name: 'P', sku: null } as unknown as Product;
}

function makeVariant(id: string): ProductVariant {
  return { id, productId: internalProductId, sku: null, attributes: null, ean: null, gtin: null };
}

describe('MasterProductSyncService', () => {
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let productsService: jest.Mocked<
    Pick<IProductsService, 'upsertProduct' | 'upsertVariants' | 'markVariantsStaleExcept'>
  >;
  let eventPublisher: jest.Mocked<EventPublisherPort>;
  let adapter: jest.Mocked<Pick<ProductMasterPort, 'getProduct' | 'getProductVariants'>>;
  let service: MasterProductSyncService;

  beforeEach(() => {
    adapter = {
      getProduct: jest.fn().mockResolvedValue(makeProduct()),
      getProductVariants: jest.fn().mockResolvedValue([makeVariant('ol_variant_1')]),
    };

    integrationsService = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(adapter),
    } as unknown as jest.Mocked<IIntegrationsService>;

    identifierMapping = {
      getOrCreateInternalId: jest.fn().mockResolvedValue(internalProductId),
    } as unknown as jest.Mocked<IIdentifierMappingService>;

    productsService = {
      upsertProduct: jest.fn().mockResolvedValue(makeProduct()),
      upsertVariants: jest.fn().mockResolvedValue(undefined),
      markVariantsStaleExcept: jest.fn().mockResolvedValue([]),
    };

    eventPublisher = {
      publish: jest.fn().mockResolvedValue('msg-1'),
    } as unknown as jest.Mocked<EventPublisherPort>;

    service = new MasterProductSyncService(
      integrationsService,
      identifierMapping,
      productsService as unknown as IProductsService,
      eventPublisher
    );
  });

  it('prunes absent variants and emits master.variant.stale on a successful pull', async () => {
    productsService.markVariantsStaleExcept.mockResolvedValueOnce(['ol_variant_gone']);

    const result = await service.syncFromMasterByExternalId(connectionId, externalId);

    expect(productsService.markVariantsStaleExcept).toHaveBeenCalledWith(internalProductId, [
      'ol_variant_1',
    ]);
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      MASTER_DELETION_EVENT_STREAM,
      expect.objectContaining({ eventType: MASTER_VARIANT_STALE_EVENT })
    );
    expect(result).toEqual({ internalProductId, variantsUpserted: 1, masterDeleted: false });
  });

  it('does not emit when nothing was newly marked stale', async () => {
    productsService.markVariantsStaleExcept.mockResolvedValueOnce([]);

    await service.syncFromMasterByExternalId(connectionId, externalId);

    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('skips the prune on a successful pull that returns zero variants (avoids staling all on a flaky empty response)', async () => {
    adapter.getProductVariants.mockResolvedValueOnce([]);

    const result = await service.syncFromMasterByExternalId(connectionId, externalId);

    // A genuine full deletion arrives as MasterProductNotFoundError, not an
    // empty 200 — so an empty variant list must NOT prune (would stale everything).
    expect(productsService.markVariantsStaleExcept).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
    expect(result).toEqual({ internalProductId, variantsUpserted: 0, masterDeleted: false });
  });

  it('marks all variants stale, emits master.product.stale and reports masterDeleted on a 404', async () => {
    adapter.getProduct.mockRejectedValueOnce(
      new MasterProductNotFoundError(internalProductId, connectionId)
    );
    productsService.markVariantsStaleExcept.mockResolvedValueOnce(['ol_variant_1', 'ol_variant_2']);

    const result = await service.syncFromMasterByExternalId(connectionId, externalId);

    // Empty keep-set ⇒ mark every variant of the product stale.
    expect(productsService.markVariantsStaleExcept).toHaveBeenCalledWith(internalProductId, []);
    expect(productsService.upsertProduct).not.toHaveBeenCalled();
    expect(productsService.upsertVariants).not.toHaveBeenCalled();
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      MASTER_DELETION_EVENT_STREAM,
      expect.objectContaining({ eventType: MASTER_PRODUCT_STALE_EVENT })
    );
    expect(result).toEqual({ internalProductId, variantsUpserted: 0, masterDeleted: true });
  });

  it('rethrows a transient (non-not-found) adapter error unchanged', async () => {
    adapter.getProduct.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(
      service.syncFromMasterByExternalId(connectionId, externalId)
    ).rejects.toThrow('ECONNRESET');
    expect(productsService.markVariantsStaleExcept).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });
});
