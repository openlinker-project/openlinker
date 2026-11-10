/**
 * Unit tests for BundleOfferPreviewService (#3520).
 *
 * The properties under test: the preview is built from the builder's component
 * resolution plus the destination's read-only planner, the suggested category is
 * the FIRST component's card category, and available sets are the minimum of
 * floor(available / quantity) with the limiting component named.
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IAvailabilityService } from '@openlinker/core/inventory';
import type { OfferProductSetComponent } from '@openlinker/core/listings';
import type { IProductsService } from '@openlinker/core/products';

import type { IOfferBuilderService } from '../../interfaces/offer-builder.service.interface';
import { BundleOfferPreviewService } from '../bundle-offer-preview.service';

const component = (variantId: string, quantity: number, extra: Partial<OfferProductSetComponent> = {}) =>
  ({
    variantId,
    productId: `p-${variantId}`,
    quantity,
    name: `Name ${variantId}`,
    barcode: null,
    imageUrls: [`https://img/${variantId}.jpg`],
    ...extra,
  }) as OfferProductSetComponent;

describe('BundleOfferPreviewService', () => {
  let builder: { resolveBundleComponents: jest.Mock };
  let destination: Record<string, unknown>;
  let integrations: { getCapabilityAdapter: jest.Mock };
  let products: { getVariantsByIds: jest.Mock };
  let availability: { getPromisableQuantities: jest.Mock };
  let service: BundleOfferPreviewService;

  beforeEach(() => {
    builder = { resolveBundleComponents: jest.fn() };
    destination = { previewProductSet: jest.fn() };
    integrations = { getCapabilityAdapter: jest.fn().mockResolvedValue(destination) };
    products = {
      getVariantsByIds: jest.fn().mockResolvedValue([
        { id: 'k', sku: 'KAW-250' },
        { id: 'c', sku: 'KUB-350' },
      ]),
    };
    availability = { getPromisableQuantities: jest.fn() };
    service = new BundleOfferPreviewService(
      builder as unknown as IOfferBuilderService,
      integrations as unknown as IIntegrationsService,
      products as unknown as IProductsService,
      availability as unknown as IAvailabilityService
    );
  });

  it('should report components with modes, the first card category and the limiting component', async () => {
    builder.resolveBundleComponents.mockResolvedValue([
      component('k', 1, { existingOfferExternalId: '778' }),
      component('c', 2, { giftSlot: true }),
    ]);
    (destination.previewProductSet as jest.Mock).mockResolvedValue([
      { variantId: 'k', mode: 'own-offer', externalOfferId: '778', cardCategoryId: '74035', problems: [] },
      {
        variantId: 'c',
        mode: 'missing',
        problems: [{ code: 'PRODUCT_SET_COMPONENT_UNPUBLISHABLE', message: 'no card' }],
      },
    ]);
    availability.getPromisableQuantities.mockResolvedValue([
      { quantity: 50, provenance: 'computed' },
      { quantity: 7, provenance: 'computed' },
    ]);

    const { entries } = await service.preview({
      connectionId: 'conn',
      items: [{ internalVariantId: 'bundle-1', categoryId: '110886' }],
    });

    expect(destination.previewProductSet).toHaveBeenCalledWith({
      categoryId: '110886',
      components: expect.any(Array),
    });
    const entry = entries[0];
    expect(entry).toMatchObject({
      status: 'ok',
      suggestedCategoryId: '74035',
      availableSets: 3,
      limitingComponentVariantId: 'c',
    });
    if (entry.status !== 'ok') throw new Error('unreachable');
    expect(entry.components[0]).toMatchObject({
      variantId: 'k',
      sku: 'KAW-250',
      mode: 'own-offer',
      externalOfferId: '778',
      giftSlot: false,
      imageUrl: 'https://img/k.jpg',
    });
    expect(entry.components[1]).toMatchObject({ mode: 'missing', giftSlot: true });
    expect(entry.components[1].problems[0].code).toBe('PRODUCT_SET_COMPONENT_UNPUBLISHABLE');
  });

  it('should report an ordinary variant as not-a-bundle without planning', async () => {
    builder.resolveBundleComponents.mockResolvedValue(undefined);
    const { entries } = await service.preview({
      connectionId: 'conn',
      items: [{ internalVariantId: 'v1' }],
    });
    expect(entries).toEqual([{ internalVariantId: 'v1', status: 'not-a-bundle' }]);
    expect(destination.previewProductSet).not.toHaveBeenCalled();
  });

  it('should report planning-unsupported when the destination has no planner', async () => {
    destination = {};
    integrations.getCapabilityAdapter.mockResolvedValue(destination);
    builder.resolveBundleComponents.mockResolvedValue([component('k', 1)]);
    const { entries } = await service.preview({ connectionId: 'conn', items: [{ internalVariantId: 'b' }] });
    expect(entries[0]).toEqual({
      internalVariantId: 'b',
      status: 'failed',
      reason: 'planning-unsupported',
    });
  });

  it('should leave available sets unknown rather than guess when a component is unknown', async () => {
    builder.resolveBundleComponents.mockResolvedValue([component('k', 1), component('c', 1)]);
    (destination.previewProductSet as jest.Mock).mockResolvedValue([]);
    availability.getPromisableQuantities.mockResolvedValue([
      { quantity: 5, provenance: 'computed' },
      { quantity: null, provenance: 'unknown' },
    ]);
    const { entries } = await service.preview({ connectionId: 'conn', items: [{ internalVariantId: 'b' }] });
    expect(entries[0]).toMatchObject({
      status: 'ok',
      availableSets: null,
      limitingComponentVariantId: null,
    });
  });

  it('should report a failure per entry and keep the rest of the batch', async () => {
    builder.resolveBundleComponents
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const { entries } = await service.preview({
      connectionId: 'conn',
      items: [{ internalVariantId: 'a' }, { internalVariantId: 'b' }],
    });
    expect(entries.map((e) => e.status)).toEqual(['failed', 'not-a-bundle']);
  });
});
