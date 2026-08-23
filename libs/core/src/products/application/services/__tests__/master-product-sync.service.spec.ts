/**
 * Master Product Sync Service Tests
 *
 * Covers the master-deletion propagation added in #1599: the unconditional
 * variant-prune after a successful pull (emitting `master.variant.stale`), the
 * 404 branch (neutral `MasterProductNotFoundError` → mark all variants stale,
 * emit `master.product.stale`, `masterDeleted: true`, no upsert), and that a
 * transient failure rethrows unchanged. Also covers the connection-ownership
 * guard added in #1904: both prune paths are withheld when a second
 * ProductMaster connection claims the same internal product id.
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
import type { IEntityClaimService, IIntegrationsService } from '@openlinker/core/integrations';
import type { ITaxRateJournalService } from '../tax-rate-journal.service.interface';
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import type { EventPublisherPort } from '@openlinker/core/events';
import type { Product } from '../../../domain/entities/product.entity';
import type { ProductVariant } from '../../../domain/entities/product-variant.entity';
import type { ProductMasterPort } from '../../../domain/ports/product-master.port';
import type { StoredTaxRate, TaxRateResolution } from '../../../domain/types/tax-rate.types';
import { effectiveTaxRate } from '../../../domain/types/tax-rate.types';

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
    Pick<
      IProductsService,
      | 'upsertProduct'
      | 'upsertVariants'
      | 'markVariantsStaleExcept'
      | 'recordProductTaxRate'
      | 'recordVariantTaxRate'
      | 'clearVariantTaxRate'
    >
  >;
  let eventPublisher: jest.Mocked<EventPublisherPort>;
  let entityClaims: jest.Mocked<IEntityClaimService>;
  let taxRateJournal: jest.Mocked<ITaxRateJournalService>;
  let adapter: jest.Mocked<Pick<ProductMasterPort, 'getProduct' | 'getProductVariants'>> & {
    readProductTaxRate?: jest.Mock;
    readsTaxRatePerVariant?: jest.Mock;
  };
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
      recordProductTaxRate: jest.fn().mockResolvedValue(undefined),
      recordVariantTaxRate: jest.fn().mockResolvedValue(undefined),
      clearVariantTaxRate: jest.fn().mockResolvedValue(undefined),
    };

    eventPublisher = {
      publish: jest.fn().mockResolvedValue('msg-1'),
    } as unknown as jest.Mocked<EventPublisherPort>;

    // Default: this connection is the only ProductMaster claiming the internal
    // product id, so the ownership guard (#1904) never blocks the prune.
    entityClaims = {
      findRivalClaimants: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IEntityClaimService>;


    // #2250: the journal is provenance only, so these specs assert the sync's
    // own behaviour with a no-op recorder.
    taxRateJournal = {
      record: jest.fn().mockResolvedValue(null),
      getLatestPerConnection: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<ITaxRateJournalService>;

    service = new MasterProductSyncService(
      integrationsService,
      identifierMapping,
      productsService as unknown as IProductsService,
      eventPublisher,
      entityClaims,
      taxRateJournal
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
    const [, envelope] = eventPublisher.publish.mock.calls[0];
    const payload = JSON.parse(envelope.payloadJson) as {
      correlationId: string;
      externalId: string;
      variantIds: string[];
    };
    expect(payload.externalId).toBe(externalId);
    expect(typeof payload.correlationId).toBe('string');
    expect(payload.correlationId.length).toBeGreaterThan(0);
    expect(result).toEqual({
      internalProductId,
      variantsUpserted: 1,
      masterDeleted: false,
      pruneSkipped: false,
      pruneSkippedReason: null,
    });
  });

  it('sanitizes a hostile master description before persisting it (#2198)', async () => {
    // OpenLinker pulls whatever the master returns, so a compromised or hostile
    // source shop is the realistic vector for stored XSS. Sanitized at this
    // choke point rather than in each adapter's mapper, so every current and
    // future ProductMaster is covered by one call.
    adapter.getProduct.mockResolvedValueOnce({
      ...makeProduct(),
      description: '<p>Real copy</p><script>fetch("https://evil.example")</script>',
    });

    await service.syncFromMasterByExternalId(connectionId, externalId);

    const persisted = productsService.upsertProduct.mock.calls[0][0] as { description: string };
    expect(persisted.description).not.toContain('<script');
    expect(persisted.description).not.toContain('evil.example');
    expect(persisted.description).toContain('<p>Real copy</p>');
  });

  it('keeps a shop description the destinations would reject, since narrowing is the publish path', async () => {
    adapter.getProduct.mockResolvedValueOnce({
      ...makeProduct(),
      description: '<div style="font-family:Verdana"><table><tbody><tr><td>620 g</td></tr></tbody></table></div>',
    });

    await service.syncFromMasterByExternalId(connectionId, externalId);

    const persisted = productsService.upsertProduct.mock.calls[0][0] as { description: string };
    expect(persisted.description).toContain('<table>');
    expect(persisted.description).toContain('Verdana');
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
    expect(result).toEqual({
      internalProductId,
      variantsUpserted: 0,
      masterDeleted: false,
      // `pruneSkipped` stays false — it means RIVAL-blocked. The zero-variant
      // skip reports itself through the reason instead, so an operator can tell
      // a #1904 collision from a flaky master response (#2222).
      pruneSkipped: false,
      pruneSkippedReason: 'empty-response',
    });
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
    const [, envelope] = eventPublisher.publish.mock.calls[0];
    const payload = JSON.parse(envelope.payloadJson) as {
      correlationId: string;
      externalId: string;
    };
    expect(payload.externalId).toBe(externalId);
    expect(typeof payload.correlationId).toBe('string');
    expect(result).toEqual({
      internalProductId,
      variantsUpserted: 0,
      masterDeleted: true,
      pruneSkipped: false,
      pruneSkippedReason: null,
    });
  });

  it('rethrows a transient (non-not-found) adapter error unchanged', async () => {
    adapter.getProduct.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(
      service.syncFromMasterByExternalId(connectionId, externalId)
    ).rejects.toThrow('ECONNRESET');
    expect(productsService.markVariantsStaleExcept).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  // Connection-ownership guard (#1904): the prune keys on internalProductId
  // alone, so it is withheld whenever a SECOND connection with ProductMaster
  // enabled also claims that id - otherwise one master's 404 (or a response
  // missing the sibling's variants) would stale variants the sibling still
  // considers live.
  describe('rival-master ownership guard (#1904)', () => {
    const rival = 'connection-rival';

    it('queries the claim service scoped to the product id, the ProductMaster capability and this connection', async () => {
      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(entityClaims.findRivalClaimants).toHaveBeenCalledWith({
        entityType: 'Product',
        internalId: internalProductId,
        capability: 'ProductMaster',
        excludeConnectionId: connectionId,
      });
    });

    it('skips the post-pull prune, emits no event and reports pruneSkipped when a rival ProductMaster claims the same product id', async () => {
      entityClaims.findRivalClaimants.mockResolvedValue([rival]);

      const result = await service.syncFromMasterByExternalId(connectionId, externalId);

      // Upserts still run - only the destructive sweep is withheld.
      expect(productsService.upsertProduct).toHaveBeenCalledTimes(1);
      expect(productsService.upsertVariants).toHaveBeenCalledTimes(1);
      expect(productsService.markVariantsStaleExcept).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
      expect(result).toEqual({
        internalProductId,
        variantsUpserted: 1,
        masterDeleted: false,
        pruneSkipped: true,
        pruneSkippedReason: 'rival',
      });
    });

    it('skips the deletion prune, emits no event and still reports masterDeleted when a rival ProductMaster claims the same product id', async () => {
      adapter.getProduct.mockRejectedValueOnce(
        new MasterProductNotFoundError(internalProductId, connectionId)
      );
      entityClaims.findRivalClaimants.mockResolvedValue([rival]);

      const result = await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(productsService.markVariantsStaleExcept).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
      expect(result).toEqual({
        internalProductId,
        variantsUpserted: 0,
        masterDeleted: true,
        pruneSkipped: true,
        pruneSkippedReason: 'rival',
      });
    });
  });

  // #2054 review — the tax-rate projection pulled in the same pass as price and
  // currency. Three properties, each of which was a live silent-wrong-rate
  // defect before this round: an override that is never cleared, an unreadable
  // answer persisted as *no rate*, and one bad variant costing its siblings.
  describe('tax-rate read (#2054)', () => {
    /** A variant-keyed master, the shape WooCommerce reports. */
    function makeTaxReader(
      answers: (input: { productId: string; variantId?: string }) => TaxRateResolution
    ): void {
      adapter.readsTaxRatePerVariant = jest.fn().mockReturnValue(true);
      adapter.readProductTaxRate = jest
        .fn()
        .mockImplementation((input: { productId: string; variantId?: string }) =>
          Promise.resolve(answers(input))
        );
    }

    it('clears a stale variant override when the shop says the variant now inherits', async () => {
      // The whole scenario, end to end. The variation was published at 5% and
      // stored an override; the operator moved it back to the product's tax
      // class and set the product to 23%. Before this fix the `inherited` read
      // was skipped, `effectiveTaxRate` kept preferring the known variant code,
      // and every later order line settled at 5% - on a 23% sale, with no
      // journal entry to show it.
      let productRow: StoredTaxRate | null = null;
      let variantRow: StoredTaxRate | null = {
        code: '5',
        countryIso2: 'PL',
        readAt: new Date('2026-08-01T00:00:00Z'),
      };
      productsService.recordProductTaxRate.mockImplementation((_id, rate) => {
        productRow = rate;
        return Promise.resolve();
      });
      productsService.recordVariantTaxRate.mockImplementation((_id, rate) => {
        variantRow = rate;
        return Promise.resolve();
      });
      productsService.clearVariantTaxRate.mockImplementation(() => {
        variantRow = null;
        return Promise.resolve();
      });

      makeTaxReader((input) =>
        input.variantId
          ? { kind: 'inherited' }
          : { kind: 'resolved', code: '23', countryIso2: 'PL' }
      );

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(productsService.clearVariantTaxRate).toHaveBeenCalledWith('ol_variant_1');
      expect(productsService.recordVariantTaxRate).not.toHaveBeenCalled();
      // The line now settles at the product's rate, which is what the shop says.
      expect(effectiveTaxRate(productRow, variantRow).code).toBe('23');
    });

    it('journals the transition off an override, so the clear is not silent', async () => {
      makeTaxReader((input) =>
        input.variantId
          ? { kind: 'inherited' }
          : { kind: 'resolved', code: '23', countryIso2: 'PL' }
      );

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(taxRateJournal.record).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: internalProductId,
          variantId: 'ol_variant_1',
          connectionId,
          origin: 'shop',
          taxRate: null,
        })
      );
    });

    it('does NOT persist an unreadable answer, at either level', async () => {
      // `unreadable` means the read established nothing (a failed settings
      // call), and persisting it writes the *no-rate* state - which blocks
      // documents and refuses publishes for a shop that is configured fine.
      makeTaxReader(() => ({ kind: 'unknown', reason: 'unreadable', detail: 'settings 500' }));

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(productsService.recordProductTaxRate).not.toHaveBeenCalled();
      expect(productsService.recordVariantTaxRate).not.toHaveBeenCalled();
      expect(productsService.clearVariantTaxRate).not.toHaveBeenCalled();
      expect(taxRateJournal.record).not.toHaveBeenCalled();
    });

    it('persists the unknowns that mean the master answered', async () => {
      makeTaxReader((input) =>
        input.variantId
          ? { kind: 'unknown', reason: 'ambiguous' }
          : { kind: 'unknown', reason: 'not-configured' }
      );

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(productsService.recordProductTaxRate).toHaveBeenCalledWith(
        internalProductId,
        expect.objectContaining({ code: null, readAt: expect.any(Date) })
      );
      expect(productsService.recordVariantTaxRate).toHaveBeenCalledWith(
        'ol_variant_1',
        expect.objectContaining({ code: null, readAt: expect.any(Date) })
      );
    });

    it('records the rate the master states, at both levels', async () => {
      makeTaxReader((input) =>
        input.variantId
          ? { kind: 'resolved', code: '5', countryIso2: 'PL' }
          : { kind: 'resolved', code: '23', countryIso2: 'PL' }
      );

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(productsService.recordProductTaxRate).toHaveBeenCalledWith(
        internalProductId,
        expect.objectContaining({ code: '23', countryIso2: 'PL' })
      );
      expect(productsService.recordVariantTaxRate).toHaveBeenCalledWith(
        'ol_variant_1',
        expect.objectContaining({ code: '5', countryIso2: 'PL' })
      );
    });

    it('keeps reading the remaining variants when one variant read throws', async () => {
      adapter.getProductVariants.mockResolvedValue([
        makeVariant('ol_variant_1'),
        makeVariant('ol_variant_2'),
      ]);
      adapter.readsTaxRatePerVariant = jest.fn().mockReturnValue(true);
      adapter.readProductTaxRate = jest
        .fn()
        .mockImplementation((input: { productId: string; variantId?: string }) => {
          if (input.variantId === 'ol_variant_1') return Promise.reject(new Error('502'));
          if (input.variantId === 'ol_variant_2')
            return Promise.resolve({ kind: 'resolved', code: '5', countryIso2: 'PL' });
          return Promise.resolve({ kind: 'resolved', code: '23', countryIso2: 'PL' });
        });

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(productsService.recordVariantTaxRate).toHaveBeenCalledTimes(1);
      expect(productsService.recordVariantTaxRate).toHaveBeenCalledWith(
        'ol_variant_2',
        expect.objectContaining({ code: '5' })
      );
    });

    it('never touches a variant row on a product-keyed master', async () => {
      // PrestaShop keys tax on the product, so a per-variant write would turn
      // one shared value into N copies that drift.
      adapter.readsTaxRatePerVariant = jest.fn().mockReturnValue(false);
      adapter.readProductTaxRate = jest
        .fn()
        .mockResolvedValue({ kind: 'resolved', code: '23', countryIso2: 'PL' });

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(productsService.recordProductTaxRate).toHaveBeenCalledTimes(1);
      expect(productsService.recordVariantTaxRate).not.toHaveBeenCalled();
      expect(productsService.clearVariantTaxRate).not.toHaveBeenCalled();
    });
  });
});
